const test = require('node:test');
const assert = require('node:assert/strict');

const protocol = require('../web/protocol.js');

test('parses a shelter request from the README', () => {
  assert.deepEqual(protocol.parseRequest('REQ|1|A17K|SHELTER|DHK'), {
    type: 'REQ',
    version: '1',
    requestId: 'A17K',
    command: 'SHELTER',
    arguments: 'DHK'
  });
});

test('serializes an alert request', () => {
  const rawText = protocol.serializeRequest({
    requestId: 'F22P',
    command: 'ALERT',
    arguments: 'DHK'
  });

  assert.equal(rawText, 'REQ|1|F22P|ALERT|DHK');
  assert.equal(protocol.parseRequest(rawText).command, 'ALERT');
});

test('serializes a hazard request', () => {
  const rawText = protocol.serializeRequest({
    requestId: 'HZ91',
    command: 'HAZARD',
    arguments: 'DHK'
  });

  assert.equal(rawText, 'REQ|1|HZ91|HAZARD|DHK');
  assert.equal(protocol.parseRequest(rawText).command, 'HAZARD');
});

test('serializes requests and escapes delimiter characters', () => {
  const request = {
    requestId: 'A17K',
    command: 'REPORT',
    arguments: 'ROAD,OPEN,MIRPUR|NORTH\\GATE'
  };

  const serialized = protocol.serializeRequest(request);

  assert.equal(serialized, 'REQ|1|A17K|REPORT|ROAD,OPEN,MIRPUR\\|NORTH\\\\GATE');
  assert.deepEqual(protocol.parseRequest(serialized), {
    type: 'REQ',
    version: '1',
    requestId: 'A17K',
    command: 'REPORT',
    arguments: request.arguments
  });
});

test('parses and serializes a shelter response from the README', () => {
  const response = protocol.parseResponse(
    'RES|1|A17K|SHELTER|1/1|DHK|MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL'
  );

  assert.deepEqual(response, {
    type: 'RES',
    version: '1',
    requestId: 'A17K',
    page: 'SHELTER',
    part: '1/1',
    region: 'DHK',
    payload: 'MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL'
  });

  assert.equal(protocol.serializeResponse(response),
    'RES|1|A17K|SHELTER|1/1|DHK|MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL');
});

test('supports escaped delimiters in response payloads', () => {
  const response = {
    requestId: 'A17K',
    page: 'ROAD',
    part: '1/1',
    region: 'DHK',
    payload: 'MIRPUR|BRIDGE:BLOCKED'
  };

  assert.equal(protocol.serializeResponse(response),
    'RES|1|A17K|ROAD|1/1|DHK|MIRPUR\\|BRIDGE:BLOCKED');
  assert.equal(protocol.parseResponse(protocol.serializeResponse(response)).payload,
    response.payload);
});

test('parses and serializes response trust and freshness metadata', () => {
  const rawText = 'RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|MIRPUR:120:OPEN';
  const response = protocol.parseResponse(rawText);

  assert.deepEqual(response, {
    type: 'RES',
    version: '1',
    requestId: 'A17K',
    page: 'SHELTER',
    part: '1/1',
    region: 'DHK',
    payload: 'MIRPUR:120:OPEN',
    trust: 'DEMO',
    source: 'SMSWEB_DEMO',
    verifiedAt: 1785362400,
    expiresAt: 1785384000
  });
  assert.equal(protocol.serializeResponse(response), rawText);
});

test('parses and serializes authenticated response and alert tags', () => {
  const signature = 'abcdefghijklmnopqrstuv';
  const responseText =
    `RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|MIRPUR:120:OPEN|${signature}`;
  const response = protocol.parseResponse(responseText);

  assert.equal(response.signature, signature);
  assert.equal(response.payload, 'MIRPUR:120:OPEN');
  assert.equal(protocol.serializeResponse(response), responseText);

  const alertText = `ALT|1|F22P|HIGH|1785384000|DHK|Avoid Mirpur bridge|${signature}`;
  const alert = protocol.parseAlert(alertText);
  assert.equal(alert.signature, signature);
  assert.equal(protocol.serializeAlert(alert), alertText);
});

test('parses alerts and converts expiry to a number', () => {
  assert.deepEqual(protocol.parseAlert(
    'ALT|1|F22P|HIGH|1764000000|DHK|Avoid road near Mirpur bridge'
  ), {
    type: 'ALT',
    version: '1',
    alertId: 'F22P',
    priority: 'HIGH',
    expires: 1764000000,
    region: 'DHK',
    message: 'Avoid road near Mirpur bridge'
  });
});

test('rejects unsupported commands, pages, versions, and invalid parts', () => {
  assert.throws(() => protocol.parseRequest('REQ|1|A17K|UNKNOWN|-'), /unknown command/);
  assert.throws(() => protocol.parseResponse('RES|1|A17K|UNKNOWN|1/1|DHK|data'), /unknown page/);
  assert.throws(() => protocol.parseResponse('RES|2|A17K|SHELTER|1/1|DHK|data'), /unsupported version/);
  assert.throws(() => protocol.parseResponse('RES|1|A17K|SHELTER|2/1|DHK|data'), /cannot exceed/);
  assert.throws(
    () => protocol.parseResponse('RES|1|A17K|SHELTER|1/1|DHK|VERIFIED|BAD SOURCE|1785362400|1785384000|data'),
    /source must contain/
  );
  assert.throws(
    () => protocol.parseResponse('RES|1|A17K|SHELTER|1/1|DHK|VERIFIED|AUTHORITY|1785362400|1785362300|data'),
    /later than verifiedAt/
  );
  assert.throws(() => protocol.parseAlert('ALT|1|F22P|HIGH|0|DHK|Expired'), /positive Unix timestamp/);
  assert.throws(
    () => protocol.parseAlert('ALT|1|F22P|HIGH|1785384000|DHK|Alert|bad-tag'),
    /128-bit URL-safe/
  );
});
