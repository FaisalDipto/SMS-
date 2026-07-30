const test = require('node:test');
const assert = require('node:assert/strict');

test('judge demo loads signed scenario messages and opens the map', async () => {
  const originalFetch = global.fetch;
  const modulePath = require.resolve('../web/demo.js');
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      mode: 'DEMO',
      messages: ['RES|one', 'RES|two'],
      location: { latitude: 23.8144, longitude: 90.3687 }
    })
  });
  delete require.cache[modulePath];
  const demo = require(modulePath);
  const container = { hidden: true };
  const status = { textContent: '' };
  const button = {
    disabled: false,
    addEventListener(_name, callback) {
      this.click = callback;
    }
  };
  const handled = [];
  const calls = [];
  const simulator = {
    handleSms: async (message, _view, _now, source, authentication) => {
      handled.push({ message, source, authentication });
    }
  };
  const navigation = {
    setDemoLocation: (location) => calls.push(['location', location]),
    show: async (page) => calls.push(['show', page])
  };

  try {
    demo.initialize({
      container,
      button,
      status,
      simulator,
      navigation,
      appView: {}
    });
    await Promise.resolve();
    await button.click();

    assert.equal(container.hidden, false);
    assert.deepEqual(handled.map((entry) => entry.message), ['RES|one', 'RES|two']);
    assert.ok(handled.every((entry) => entry.authentication === 'AUTHENTICATED'));
    assert.deepEqual(calls.at(-1), ['show', 'MAP']);
    assert.match(status.textContent, /Scenario loaded/);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[modulePath];
  }
});
