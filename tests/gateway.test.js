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
    hidden: false,
    open: false,
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
  const requestHazardsButton = element();
  const requestStatus = element();
  const authenticationKeyInput = element();
  const saveAuthenticationKeyButton = element();
  const authenticationStatus = element();
  const authenticationBadge = element();
  const authenticationKeyControls = element();
  const replaceAuthenticationKeyButton = element();
  const administratorSetup = element();

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
    requestHazardsButton,
    requestStatusElement: requestStatus,
    authenticationKeyInput,
    saveAuthenticationKeyButton,
    authenticationStatusElement: authenticationStatus,
    authenticationBadgeElement: authenticationBadge,
    authenticationKeyControls,
    replaceAuthenticationKeyButton,
    administratorSetup
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
    requestHazardsButton: element(),
    requestStatusElement: element(),
    authenticationKeyInput: element(),
    saveAuthenticationKeyButton: element(),
    authenticationStatusElement: element(),
    authenticationBadgeElement: element(),
    authenticationKeyControls: element(),
    replaceAuthenticationKeyButton: element(),
    administratorSetup: element()
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

test('exposes native gateway activity and manual retry controls', () => {
  let retried = false;
  const instance = gateway.createGateway({
    getGatewayActivity: () => JSON.stringify([
      { requestId: 'A17K', state: 'FORWARDED', createdAt: 10 }
    ]),
    retryQueuedMessages: () => {
      retried = true;
      return 'queued';
    }
  });

  assert.deepEqual(instance.getActivity(), [
    { requestId: 'A17K', state: 'FORWARDED', createdAt: 10 }
  ]);
  assert.equal(instance.retryQueuedMessages(), 'queued');
  assert.equal(retried, true);
});

test('switches between user and gateway phone roles', () => {
  let role = 'GATEWAY';
  const instance = gateway.createGateway({
    getAppRole: () => role,
    saveAppRole: (value) => {
      role = value;
      return role;
    }
  });
  const root = { dataset: {} };
  const description = element();
  const title = element();

  assert.equal(instance.getAppRole(), 'GATEWAY');
  assert.equal(instance.saveAppRole('USER'), 'USER');
  instance.applyAppRole('USER', {
    roleRoot: root,
    roleDescription: description,
    gatewayTitle: title
  });

  assert.equal(root.dataset.appRole, 'USER');
  assert.equal(title.textContent, 'Crisis information by SMS');
  assert.match(description.textContent, /renders authenticated response SMS/);
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

test('serializes and sends a hazard request through the native bridge', () => {
  let sentText;
  const instance = gateway.createGateway({
    sendSms: (_recipient, rawText) => {
      sentText = rawText;
      return 'queued';
    }
  }, protocol);

  const result = instance.sendHazardRequest('+8801700000000', 'DHK');

  assert.equal(sentText, result.rawText);
  assert.equal(protocol.parseRequest(result.rawText).command, 'HAZARD');
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
  const authenticationBadge = element();
  const authenticationKeyControls = element();
  const replaceAuthenticationKeyButton = element();
  const administratorSetup = element();

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
    requestHazardsButton: element(),
    requestStatusElement: element(),
    authenticationKeyInput,
    saveAuthenticationKeyButton,
    authenticationStatusElement: authenticationStatus,
    authenticationBadgeElement: authenticationBadge,
    authenticationKeyControls,
    replaceAuthenticationKeyButton,
    administratorSetup
  });

  assert.match(authenticationStatus.textContent, /provisioning/i);
  assert.equal(authenticationBadge.textContent, 'Setup required');
  assert.equal(administratorSetup.open, true);
  authenticationKeyInput.value = 'smsweb-demo-key-2026';
  saveAuthenticationKeyButton.listeners.click();
  assert.deepEqual(saved, ['smsweb-demo-key-2026']);
  assert.equal(authenticationKeyInput.value, '');
  assert.match(authenticationStatus.textContent, /verified/i);
  assert.equal(authenticationBadge.textContent, 'Protected');
  assert.equal(authenticationKeyControls.hidden, true);
  assert.equal(replaceAuthenticationKeyButton.hidden, false);
  assert.equal(administratorSetup.open, false);

  replaceAuthenticationKeyButton.listeners.click();
  assert.equal(authenticationKeyControls.hidden, false);
  assert.equal(replaceAuthenticationKeyButton.hidden, true);
  assert.match(authenticationStatus.textContent, /replacement/i);
});

test('starts a call sequence through the native bridge using the command mapping', () => {
  const started = [];
  const instance = gateway.createGateway({
    getCallCommandMapping: () => JSON.stringify({ SHELTER: 1, ALERT: 2, HAZARD: 3 }),
    startCallSequence: (recipient, totalCalls) => {
      started.push([recipient, totalCalls]);
      return 'started';
    }
  });
  const callStatus = element();
  instance.initialize({ callStatusElement: callStatus });

  instance.startCallSequence('+8801700000000', 'ALERT');

  assert.deepEqual(started, [['+8801700000000', 2]]);
  assert.match(callStatus.textContent, /call 1 of 2/i);

  instance.receiveCallProgress(2, 2);
  assert.match(callStatus.textContent, /call 2 of 2/i);

  instance.receiveCallSequenceDone();
  assert.match(callStatus.textContent, /complete/i);
});

test('reports permission-denied and missing-bridge outcomes for call sequences', () => {
  const deniedInstance = gateway.createGateway({
    getCallCommandMapping: () => JSON.stringify({ SHELTER: 1 }),
    startCallSequence: () => 'permission-denied'
  });
  const deniedStatus = element();
  deniedInstance.initialize({ callStatusElement: deniedStatus });
  deniedInstance.startCallSequence('+8801700000000', 'SHELTER');
  assert.match(deniedStatus.textContent, /permission is not granted/i);

  const noBridgeInstance = gateway.createGateway(null);
  const noBridgeStatus = element();
  noBridgeInstance.initialize({ callStatusElement: noBridgeStatus });
  noBridgeInstance.startCallSequence('+8801700000000', 'SHELTER');
  assert.match(noBridgeStatus.textContent, /available in the Android app/i);
});
