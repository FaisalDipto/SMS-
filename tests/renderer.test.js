const test = require('node:test');
const assert = require('node:assert/strict');

const renderer = require('../web/renderer.js');

test('escapes received text before rendering it', () => {
  const html = renderer.renderShelterPage({
    title: '<img src=x onerror=alert(1)>',
    region: 'DHK',
    payload: '<script>alert(1)</script>:12:OPEN',
    receivedAt: 1_700_000_000_000,
    expiresAt: 1_800_000_000_000
  }, 1_700_000_000_000);

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('renders shelter records with known status badges', () => {
  const shelters = renderer.parseShelterPayload('MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL');
  const html = renderer.renderShelterPage({
    title: 'Emergency Shelters - Dhaka',
    region: 'DHK',
    payload: 'MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL',
    receivedAt: 1_700_000_000_000,
    expiresAt: 1_800_000_000_000
  }, 1_700_000_000_000);

  assert.deepEqual(shelters, [
    { location: 'MIRPUR', spaces: 120, status: 'OPEN' },
    { location: 'UTTARA', spaces: 80, status: 'OPEN' },
    { location: 'DU', spaces: 0, status: 'FULL' }
  ]);
  assert.match(html, /120 spaces available/);
  assert.match(html, /class="status-badge status-open"/);
  assert.match(html, /class="status-badge status-full"/);
});

test('marks expired information clearly', () => {
  const html = renderer.renderShelterPage({
    title: 'Shelters',
    payload: 'MIRPUR:12:OPEN',
    receivedAt: 1_700_000_000_000,
    expiresAt: 1_699_999_000_000
  }, 1_700_000_000_000);

  assert.match(html, /Outdated information/);
  assert.match(html, /class="freshness freshness-expired"/);
  assert.match(html, /expired and cannot be used for routing/);
});

test('shows source, verification time, and demo trust without claiming authority verification', () => {
  const now = 1_700_000_000_000;
  const html = renderer.renderShelterPage({
    title: 'Shelters',
    payload: 'MIRPUR:12:OPEN',
    receivedAt: now,
    verifiedAt: now - 60_000,
    expiresAt: now + 60_000,
    trust: 'DEMO',
    source: 'SMSWEB_DEMO'
  }, now);

  assert.match(html, /Demo data/);
  assert.match(html, /SMSWEB_DEMO/);
  assert.match(html, /Demonstration records are not authority-verified/);
  assert.doesNotMatch(html, /trust-verified/);
});

test('disables routing for shelter information without a current expiry', () => {
  const html = renderer.renderMapPage({
    region: 'DHK',
    payload: 'MIRPUR:23.8069:90.3687:120:OPEN',
    receivedAt: 1_700_000_000_000,
    trust: 'UNVERIFIED'
  }, 1_700_000_000_000);

  assert.match(html, /id="map-route" type="button" disabled/);
  assert.match(html, /Routing is disabled until current shelter information/);
});

test('renders alert priority and escaped messages', () => {
  const html = renderer.renderAlertsPage([{
    alertId: 'F22P',
    priority: 'HIGH',
    region: 'DHK',
    message: 'Avoid <the bridge>',
    receivedAt: 1_700_000_000_000,
    expires: 1_800_000_000
  }], 1_700_000_000_000);

  assert.match(html, /HIGH/);
  assert.match(html, /Avoid &lt;the bridge&gt;/);
  assert.match(html, /Expires/);
});

test('rejects malformed shelter payloads', () => {
  assert.throws(() => renderer.parseShelterPayload('MIRPUR:OPEN'), /LOCATION:SPACES:STATUS/);
  assert.throws(() => renderer.parseShelterPayload('MIRPUR:-1:OPEN'), /location and spaces/);
  assert.throws(() => renderer.parseShelterPayload('MIRPUR:12:BROKEN'), /Unknown shelter status/);
  assert.throws(() => renderer.parseShelterPayload('MIRPUR:91:90.3687:12:OPEN'), /coordinates are invalid/);
});

test('parses shelter coordinates included in an SMS response', () => {
  assert.deepEqual(renderer.parseShelterPayload('MIRPUR:23.8069:90.3687:120:OPEN'), [{
    location: 'MIRPUR',
    latitude: 23.8069,
    longitude: 90.3687,
    spaces: 120,
    status: 'OPEN'
  }]);
});

test('renders bundled shelter coordinates on the offline map', () => {
  const html = renderer.renderMapPage({
    region: 'DHK',
    payload: 'MIRPUR:120:OPEN;UTTARA:80:OPEN',
    receivedAt: 1_700_000_000_000
  }, 1_700_000_000_000);

  assert.match(html, /offline-vector-map/);
  assert.match(html, /Loading detailed greater Dhaka map/);
  assert.match(html, /map-basemap/);
  assert.match(html, /map-viewport/);
  assert.match(html, /map-zoom-in/);
  assert.match(html, /map-rotate-right/);
  assert.match(html, /map-reset-view/);
  assert.match(html, /map-offline-roads/);
  assert.match(html, /map-user-location/);
  assert.match(html, /map-road-labels/);
  assert.match(html, /map-route-location/);
  assert.match(html, /map-route-roads/);
  assert.match(html, /BURIGANGA/);
  assert.match(html, /2 shelter markers/);
  assert.match(html, /map-marker-open/);
  assert.match(html, /data-map-location="MIRPUR"/);
  assert.match(html, /Tap a marker to view shelter details/);
  assert.match(html, /Use my location/);
  assert.match(html, /straight-line distances/);
  assert.match(html, /Find route to nearest open shelter/);
  assert.match(html, /map-route-overlay/);
  assert.match(html, /OpenStreetMap contributors/);
  assert.match(html, /Detailed basemap data is bundled for offline use/);
});

test('renders recent SMS activity safely', () => {
  const html = renderer.renderActivityPage([{
    requestId: 'A17K',
    direction: 'incoming',
    status: 'received',
    rawText: '<script>alert(1)</script>',
    createdAt: 1_700_000_000_000
  }]);

  assert.match(html, /Received response/);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /Expiry not provided/);
});
