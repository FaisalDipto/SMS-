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

test('completes native location from an accepted GPS progress update', () => {
  const calls = [];
  const instance = navigation.createNavigation({
    nativeBridge: {
      requestCurrentLocation: () => calls.push(['requested'])
    }
  });

  instance.requestCurrentLocation(
    (position) => calls.push([
      'success',
      position.coords.latitude,
      position.coords.longitude,
      position.coords.accuracy
    ]),
    (error) => calls.push(['error', error.message]),
    (message) => calls.push(['progress', message])
  );
  instance.receiveNativeLocationProgress(
    'Location signal found. Using this position.',
    23.8069,
    90.3687,
    100
  );

  assert.deepEqual(calls, [
    ['requested'],
    ['progress', 'Location signal found. Using this position.'],
    ['success', 23.8069, 90.3687, 100]
  ]);
});

test('clears the location spinner when no route has been drawn yet', async () => {
  function fakeElement() {
    const listeners = new Map();
    const classes = new Set();
    return {
      dataset: {},
      style: {},
      textContent: '',
      disabled: false,
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, active) => active ? classes.add(name) : classes.delete(name)
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: (name, listener) => listeners.set(name, listener),
      setAttribute(name, value) {
        this[name] = String(value);
      },
      replaceChildren() {},
      click() {
        listeners.get('click')?.({ target: this });
      }
    };
  }

  const map = fakeElement();
  const selection = fakeElement();
  const locateButton = fakeElement();
  const locateLabel = fakeElement();
  locateButton.querySelector = (selector) => selector === '.button-label' ? locateLabel : null;
  const routeButton = fakeElement();
  const routeLabel = fakeElement();
  routeButton.querySelector = (selector) => selector === '.button-label' ? routeLabel : null;
  const locationStatus = fakeElement();
  const distanceList = fakeElement();
  const routeLine = fakeElement();
  const userLocation = fakeElement();
  const nodes = new Map([
    ['.map-data-view', map],
    ['#map-selection', selection],
    ['#map-locate', locateButton],
    ['#map-location-status', locationStatus],
    ['#map-distance-list', distanceList],
    ['#map-route', routeButton],
    ['#map-route-line', routeLine],
    ['#map-user-location', userLocation]
  ]);
  const view = {
    querySelector: (selector) => nodes.get(selector) || null
  };
  const instance = navigation.createNavigation({
    storage: {
      getPage: async () => null,
      getActiveHazards: async () => []
    },
    renderer: {
      renderMapPage: () => 'map',
      mount: () => {}
    },
    geo: {},
    nativeBridge: {
      requestCurrentLocation: () => {}
    }
  });

  await instance.show('MAP', view);
  locateButton.click();
  instance.receiveNativeLocationProgress(
    'Recent Android location found (39 m accuracy). Using this position.',
    23.8069,
    90.3687,
    39
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(locateLabel.textContent, 'Update my location');
  assert.equal(locateButton.disabled, false);
  assert.equal(locateButton['aria-busy'], 'false');
});
