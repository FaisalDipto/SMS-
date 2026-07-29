const test = require('node:test');
const assert = require('node:assert/strict');

const simulator = require('../web/simulator.js');

function createDependencies() {
  const calls = [];

  return {
    calls,
    dependencies: {
      protocol: {
        parseResponse: (rawText) => ({
          type: 'RES',
          version: '1',
          requestId: 'A17K',
          page: 'SHELTER',
          part: '1/1',
          region: 'DHK',
          payload: rawText.split('|').slice(6).join('|')
        }),
        parseAlert: () => {
          throw new Error('not used in this test');
        }
      },
      storage: {
        saveMessage: async (message) => calls.push(['message', message]),
        savePage: async (page) => calls.push(['page', page]),
        saveAlert: async (alert) => calls.push(['alert', alert])
      },
      renderer: {
        renderShelterPage: (page) => `<article>${page.payload}</article>`,
        renderAlertsPage: () => '<article>alerts</article>',
        mount: (view, html) => calls.push(['mount', view, html])
      }
    }
  };
}

test('parses, stores, and renders a shelter response', async () => {
  const { dependencies, calls } = createDependencies();
  const appView = {};
  const now = 1_700_000_000_000;
  const instance = simulator.createSimulator(dependencies);

  const result = await instance.handleSms(
    'RES|1|A17K|SHELTER|1/1|DHK|MIRPUR:120:OPEN',
    appView,
    now
  );

  assert.equal(result, 'Rendered SHELTER response for DHK');
  assert.equal(calls[0][0], 'message');
  assert.equal(calls[1][0], 'page');
  assert.equal(calls[1][1].pageId, 'SHELTER:DHK');
  assert.deepEqual(calls[2], ['mount', appView, '<article>MIRPUR:120:OPEN</article>']);
});

test('rejects an empty simulator message', async () => {
  const { dependencies } = createDependencies();
  const instance = simulator.createSimulator(dependencies);

  await assert.rejects(instance.handleSms('  ', {}), /Paste an SMS message/);
});
