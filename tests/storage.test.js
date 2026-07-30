const test = require('node:test');
const assert = require('node:assert/strict');

const protocol = require('../web/protocol.js');
const { createFakeIndexedDB } = require('./support/fake-indexeddb.js');

function createStorage() {
  delete require.cache[require.resolve('../web/storage.js')];
  const storageModule = require('../web/storage.js');

  return storageModule;
}

test('stores and retrieves pages and filters expired alerts', async () => {
  const storage = createStorage();
  const now = 1_700_000_000_000;

  await storage.savePage({
    pageId: 'SHELTER:DHK',
    title: 'Emergency Shelters - Dhaka',
    content: 'Mirpur: 120 spaces',
    receivedAt: now,
    expiresAt: now + 60_000,
    source: 'sms'
  });
  await storage.saveAlert({
    alertId: 'ACTIVE1',
    priority: 'HIGH',
    message: 'Avoid the bridge',
    receivedAt: now,
    expiresAt: now + 60_000
  });
  await storage.saveAlert({
    alertId: 'OLDALERT',
    priority: 'LOW',
    message: 'Old message',
    receivedAt: now - 120_000,
    expiresAt: now - 60_000
  });

  assert.deepEqual(await storage.getPage('SHELTER:DHK'), {
    pageId: 'SHELTER:DHK',
    title: 'Emergency Shelters - Dhaka',
    content: 'Mirpur: 120 spaces',
    receivedAt: now,
    expiresAt: now + 60_000,
    source: 'sms'
  });
  assert.deepEqual(await storage.getActiveAlerts(now), [{
    alertId: 'ACTIVE1',
    priority: 'HIGH',
    message: 'Avoid the bridge',
    receivedAt: now,
    expiresAt: now + 60_000
  }]);
});

test('queues a serialized outgoing request as a message', async () => {
  const storage = createStorage();

  await storage.queueRequest({
    requestId: 'A17K',
    command: 'SHELTER',
    arguments: 'DHK',
    createdAt: 1_700_000_000_000
  });

  const database = await storage.openDatabase();
  const request = database.transaction('messages', 'readonly')
    .objectStore('messages')
    .get('A17K');

  const message = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();

  assert.deepEqual(message, {
    requestId: 'A17K',
    direction: 'outgoing',
    rawText: protocol.serializeRequest({
      requestId: 'A17K',
      command: 'SHELTER',
      arguments: 'DHK'
    }),
    status: 'queued',
    createdAt: 1_700_000_000_000
  });
});

test('rejects invalid records and reports unavailable IndexedDB', async () => {
  const storage = createStorage();

  assert.throws(() => storage.savePage({ pageId: 'HOME' }), /page.title/);
  assert.throws(() => storage.saveMessage({ requestId: 'A17K', rawText: 'x' }), /direction/);

  const originalIndexedDB = global.indexedDB;
  delete global.indexedDB;
  delete require.cache[require.resolve('../web/storage.js')];
  const unavailableStorage = require('../web/storage.js');
  await assert.rejects(unavailableStorage.getPage('HOME'), /IndexedDB is unavailable/);
  global.indexedDB = originalIndexedDB;
});

test('returns recent messages newest first', async () => {
  const storage = createStorage();

  await storage.saveMessage({
    requestId: 'OLD1',
    direction: 'outgoing',
    rawText: 'REQ|1|OLD1|SHELTER|DHK',
    createdAt: 1_700_000_000_000
  });
  await storage.saveMessage({
    requestId: 'NEW1',
    direction: 'incoming',
    rawText: 'RES|1|NEW1|SHELTER|1/1|DHK|DU:0:FULL',
    createdAt: 1_700_000_001_000
  });

  assert.deepEqual((await storage.getRecentMessages(1)).map((message) => message.requestId), ['NEW1']);
});

test('persists multipart response parts and completed-response markers', async () => {
  const storage = createStorage();
  const part = {
    partKey: 'RES|1|PART1|SHELTER|DHK|1',
    responseKey: 'RES|1|PART1|SHELTER|DHK',
    partNumber: 1,
    totalParts: 2,
    payload: 'MIRPUR:120:OPEN',
    receivedAt: 1_700_000_000_000
  };

  await storage.saveResponsePart(part);
  assert.deepEqual(await storage.getResponsePart(part.partKey), part);
  assert.ok((await storage.getAllResponseParts()).some((record) => record.partKey === part.partKey));
  await storage.removeResponsePart(part.partKey);
  assert.equal(await storage.getResponsePart(part.partKey), undefined);

  const completed = {
    responseKey: part.responseKey,
    completedAt: 1_700_000_001_000
  };
  await storage.saveCompletedResponse(completed);
  assert.deepEqual(await storage.getCompletedResponse(part.responseKey), completed);
  await storage.removeCompletedResponse(part.responseKey);
  assert.equal(await storage.getCompletedResponse(part.responseKey), undefined);
});
