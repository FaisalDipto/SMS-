const test = require('node:test');
const assert = require('node:assert/strict');

const gateway = require('../web/gateway.js');

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

  instance.initialize({
    urlInput,
    saveButton,
    checkButton,
    statusElement: status,
    badgeElement: badge
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
    badgeElement: badge
  });
  instance.receiveConnectionStatus(true);

  assert.equal(badge.textContent, 'Connected');
  assert.match(status.textContent, /reachable/);
});

test('forwards native SMS responses to the registered handler', () => {
  const instance = gateway.createGateway(null);
  let received;

  instance.setIncomingHandler((rawText) => {
    received = rawText;
    return 'handled';
  });

  assert.equal(instance.receiveSms('RES|1|A17K|SHELTER|1/1|DHK|DU:0:FULL'), 'handled');
  assert.equal(received, 'RES|1|A17K|SHELTER|1/1|DHK|DU:0:FULL');
});
