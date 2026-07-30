const test = require('node:test');
const assert = require('node:assert/strict');

const multipart = require('../web/multipart.js');

function createMemoryStorage() {
  const parts = new Map();
  const completed = new Map();
  return {
    saveResponsePart: async (part) => parts.set(part.partKey, part),
    getResponsePart: async (key) => parts.get(key),
    getAllResponseParts: async () => [...parts.values()],
    removeResponsePart: async (key) => parts.delete(key),
    saveCompletedResponse: async (response) => completed.set(response.responseKey, response),
    getCompletedResponse: async (key) => completed.get(key),
    removeCompletedResponse: async (key) => completed.delete(key)
  };
}

function response(part, payload) {
  return {
    type: 'RES',
    version: '1',
    requestId: 'A17K',
    page: 'SHELTER',
    part,
    region: 'DHK',
    trust: 'DEMO',
    source: 'SMSWEB_DEMO',
    verifiedAt: 1_700_000_000,
    expiresAt: 1_700_003_600,
    payload
  };
}

test('reassembles out-of-order response parts and ignores duplicates', async () => {
  const assembler = multipart.createAssembler({ storage: createMemoryStorage() });
  const second = response('2/2', 'UTTARA:80:OPEN');
  const first = response('1/2', 'MIRPUR:120:OPEN');

  assert.deepEqual(await assembler.accept(second, 'raw-second', 1_000), {
    status: 'pending',
    responseKey: 'RES|1|A17K|SHELTER|DHK',
    receivedParts: 1,
    totalParts: 2,
    missingParts: [1],
    expiredPartCount: 0
  });

  assert.equal((await assembler.accept(second, 'raw-second', 2_000)).status, 'duplicate-part');

  const completed = await assembler.accept(first, 'raw-first', 3_000);
  assert.equal(completed.status, 'complete');
  assert.equal(completed.response.part, '1/1');
  assert.equal(completed.response.payload, 'MIRPUR:120:OPEN;UTTARA:80:OPEN');
  assert.deepEqual(completed.rawTexts, ['raw-first', 'raw-second']);

  await assembler.complete(completed.responseKey, 3_000);
  assert.equal((await assembler.accept(first, 'raw-first', 4_000)).status, 'duplicate');
});

test('expires incomplete assemblies and starts waiting again', async () => {
  const assembler = multipart.createAssembler({
    storage: createMemoryStorage(),
    timeoutMs: 1_000
  });

  await assembler.accept(response('1/2', 'MIRPUR:120:OPEN'), 'first', 1_000);
  const result = await assembler.accept(response('2/2', 'UTTARA:80:OPEN'), 'second', 2_001);

  assert.equal(result.status, 'pending');
  assert.deepEqual(result.missingParts, [1]);
  assert.equal(result.expiredPartCount, 1);
});

test('rejects conflicting duplicate parts and invalid numbering', async () => {
  const assembler = multipart.createAssembler({ storage: createMemoryStorage() });
  await assembler.accept(response('1/2', 'MIRPUR:120:OPEN'), 'first', 1_000);

  await assert.rejects(
    assembler.accept(response('1/2', 'MIRPUR:99:OPEN'), 'changed', 1_100),
    /Conflicting content/
  );
  assert.throws(() => multipart.parsePart('3/2'), /cannot exceed/);
});
