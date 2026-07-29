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
});

test('renders bundled shelter coordinates on the offline map', () => {
  const html = renderer.renderMapPage({
    region: 'DHK',
    payload: 'MIRPUR:120:OPEN;UTTARA:80:OPEN',
    receivedAt: 1_700_000_000_000
  }, 1_700_000_000_000);

  assert.match(html, /DHK shelter markers/);
  assert.match(html, /2 shelter markers/);
  assert.match(html, /map-marker-open/);
  assert.match(html, /data-map-location="MIRPUR"/);
  assert.match(html, /Tap a marker to view shelter details/);
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
