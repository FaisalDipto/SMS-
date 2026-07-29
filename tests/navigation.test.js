const test = require('node:test');
const assert = require('node:assert/strict');

const navigation = require('../web/navigation.js');

test('loads stored shelter data when the shelters page is selected', async () => {
  const calls = [];
  const view = {};
  const instance = navigation.createNavigation({
    storage: {
      getPage: async (pageId) => ({
        pageId,
        title: 'Emergency Shelters',
        region: 'DHK',
        payload: 'MIRPUR:120:OPEN'
      })
    },
    renderer: {
      renderShelterPage: (page) => `shelter:${page.payload}`,
      renderHomePage: () => 'home',
      renderAlertsPage: () => 'alerts',
      escapeHtml: (value) => value,
      mount: (target, html) => calls.push([target, html])
    }
  });

  await instance.show('SHELTER', view);

  assert.deepEqual(calls, [[view, 'shelter:MIRPUR:120:OPEN']]);
});

test('shows the offline shelter map page', async () => {
  const calls = [];
  const view = {};
  const instance = navigation.createNavigation({
    storage: {
      getPage: async () => ({ payload: 'MIRPUR:120:OPEN' })
    },
    renderer: {
      mount: (target, html) => calls.push([target, html]),
      renderMapPage: (page) => `map:${page.payload}`
    }
  });

  await instance.show('MAP', view);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'map:MIRPUR:120:OPEN');
});

test('shows recent message activity', async () => {
  const calls = [];
  const view = {};
  const instance = navigation.createNavigation({
    storage: {
      getRecentMessages: async () => [{ requestId: 'A17K' }]
    },
    renderer: {
      mount: (target, html) => calls.push([target, html]),
      renderActivityPage: (messages) => `activity:${messages[0].requestId}`
    }
  });

  await instance.show('ACTIVITY', view);

  assert.deepEqual(calls, [[view, 'activity:A17K']]);
});
