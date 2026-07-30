const test = require('node:test');
const assert = require('node:assert/strict');

const gateway = require('../web/gateway.js');
const protocol = require('../web/protocol.js');

function element(initial = {}) {
  return {
    className: initial.className || '',
    textContent: initial.textContent || '',
    value: initial.value || '',
    disabled: false,
    listeners: {},
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }
  };
}

test('loads and saves the native Pi URL', () => {
  const calls = [];
  const bridge = {
    getPiUrl: () => 'http://192.168.0.103:8080',
    savePiUrl: (value) => {
      calls.push(value);
      return value.trim();
    },
    checkPiConnection: () => {}
  };
  const instance = gateway.createGateway(bridge);
  const urlInput = element();
  const saveButton = element();
  const checkButton = element();
  const status = element();
  const badge = element();
  const serviceNumber = element();
  const saveServiceNumberButton = element();
  const requestSheltersButton = element();
  const requestAlertsButton = element();
  const requestStatus = element();
  const authenticationKeyInput = element();
  const saveAuthenticationKeyButton = element();
  const authenticationStatus = element();

  instance.initialize({
    urlInput,
    saveButton,
    checkButton,
    statusElement: status,
    badgeElement: badge,
    serviceNumber,
    saveServiceNumberButton,
    requestSheltersButton,
    requestAlertsButton,
    requestStatusElement: requestStatus,
    authenticationKeyInput,
    saveAuthenticationKeyButton,
    authenticationStatusElement: authenticationStatus
  });

  assert.equal(urlInput.value, 'http://192.168.0.103:8080');
  urlInput.value = ' http://192.168.0.103:8080/ ';
  saveButton.listeners.click();
  assert.deepEqual(calls, [' http://192.168.0.103:8080/ ']);
  assert.equal(status.textContent, 'Pi URL saved on this phone.');
});

test('updates the badge when the native health result arrives', () => {
  const instance = gateway.createGateway({ getPiUrl: () => 'http://pi:8080' });
  const badge = element();
  const status = element();

  instance.initialize({
    urlInput: element(),
    saveButton: element(),
    checkButton: element(),
    statusElement: status,
    badgeElement: badge,
    serviceNumber: element(),
    saveServiceNumberButton: element(),
    requestSheltersButton: element(),
    requestAlertsButton: element(),
    requestStatusElement: element(),
    authenticationKeyInput: element(),
    saveAuthenticationKeyButton: element(),
    authenticationStatusElement: element()
  });
  instance.receiveConnectionStatus(true);

  assert.equal(badge.textContent, 'Connected');
  assert.match(status.textContent, /reachable/);
});

test('forwards native SMS responses and authentication status to the handler', () => {
  const instance = gateway.createGateway(null);
  let received;

  instance.setIncomingHandler((rawText, authentication) => {
    received = [rawText, authentication];
    return 'handled';
  });

  const rawText = 'RES|1|A17K|SHELTER|1/1|DHK|DU:0:FULL';
  assert.equal(instance.receiveSms(rawText, 'AUTHENTICATED'), 'handled');
  assert.deepEqual(received, [rawText, 'AUTHENTICATED']);
});

test('serializes and sends a shelter request through the native bridge', () => {
  const calls = [];
  const instance = gateway.createGateway({
    sendSms: (recipient, rawText) => {
      calls.push([recipient, rawText]);
      return 'queued';
    }
  }, protocol);

  const result = instance.sendShelterRequest('+8801700000000', 'DHK');

  assert.match(result.requestId, /^R[A-Z0-9]+$/);
  assert.equal(calls[0][0], '+8801700000000');
  assert.equal(calls[0][1], result.rawText);
  assert.deepEqual(protocol.parseRequest(result.rawText), {
    type: 'REQ',
    version: '1',
    requestId: result.requestId,
    command: 'SHELTER',
    arguments: 'DHK'
  });
});

test('serializes and sends an alert request through the native bridge', () => {
  let sentText;
  const instance = gateway.createGateway({
    sendSms: (_recipient, rawText) => {
      sentText = rawText;
      return 'queued';
    }
  }, protocol);

  const result = instance.sendAlertRequest('+8801700000000', 'DHK');

  assert.equal(sentText, result.rawText);
  assert.equal(protocol.parseRequest(result.rawText).command, 'ALERT');
});

test('replays pending native responses and acknowledges them', async () => {
  const acknowledged = [];
  const instance = gateway.createGateway({
    getPendingResponses: () => JSON.stringify([{
      id: 7,
      text: 'RES|1|A17K|SHELTER|1/1|DHK|DU:0:FULL',
      authentication: 'AUTHENTICATED'
    }]),
    acknowledgeResponse: (text) => acknowledged.push(text)
  });
  const received = [];

  instance.setIncomingHandler(async (rawText, authentication) =>
    received.push([rawText, authentication]));
  await instance.replayPendingResponses();

  assert.deepEqual(received, [[
    'RES|1|A17K|SHELTER|1/1|DHK|DU:0:FULL',
    'AUTHENTICATED'
  ]]);
  assert.deepEqual(acknowledged, [received[0][0]]);
});

test('stores the authentication key through the native-only bridge', () => {
  const saved = [];
  const instance = gateway.createGateway({
    getPiUrl: () => 'http://pi:8080',
    getAuthenticationStatus: () => 'missing',
    saveAuthenticationKey: (value) => {
      saved.push(value);
      return value.length >= 16 ? 'configured' : 'invalid';
    }
  });
  const authenticationKeyInput = element();
  const saveAuthenticationKeyButton = element();
  const authenticationStatus = element();

  instance.initialize({
    urlInput: element(),
    saveButton: element(),
    checkButton: element(),
    statusElement: element(),
    badgeElement: element(),
    serviceNumber: element(),
    saveServiceNumberButton: element(),
    requestSheltersButton: element(),
    requestAlertsButton: element(),
    requestStatusElement: element(),
    authenticationKeyInput,
    saveAuthenticationKeyButton,
    authenticationStatusElement: authenticationStatus
  });

  assert.match(authenticationStatus.textContent, /missing/i);
  authenticationKeyInput.value = 'smsweb-demo-key-2026';
  saveAuthenticationKeyButton.listeners.click();
  assert.deepEqual(saved, ['smsweb-demo-key-2026']);
  assert.equal(authenticationKeyInput.value, '');
  assert.match(authenticationStatus.textContent, /saved/i);
});
