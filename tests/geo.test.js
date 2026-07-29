const test = require('node:test');
const assert = require('node:assert/strict');

const geo = require('../web/geo.js');

test('calculates a great-circle distance between Dhaka shelter coordinates', () => {
  const distance = geo.distanceKm(
    { latitude: 23.8069, longitude: 90.3687 },
    { latitude: 23.8759, longitude: 90.4002 }
  );

  assert.ok(distance > 8 && distance < 9, `unexpected distance: ${distance}`);
  assert.equal(geo.formatDistance(distance), '8.3 km');
});

test('rejects invalid geographic coordinates', () => {
  assert.throws(() => geo.distanceKm(
    { latitude: 91, longitude: 90 },
    { latitude: 23, longitude: 90 }
  ), /Origin coordinates are invalid/);
});
