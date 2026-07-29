const test = require('node:test');
const assert = require('node:assert/strict');

const offlineMap = require('../web/map.js');

test('converts shelters into GeoJSON map features', () => {
  const data = offlineMap.shelterFeatures([{
    location: 'MIRPUR',
    spaces: 120,
    status: 'OPEN',
    coordinates: { latitude: 23.8069, longitude: 90.3687 }
  }]);

  assert.deepEqual(data.features[0], {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [90.3687, 23.8069]
    },
    properties: {
      location: 'MIRPUR',
      spaces: 120,
      status: 'OPEN'
    }
  });
});

test('converts a calculated route into a GeoJSON line', () => {
  const data = offlineMap.routeFeature({
    coordinates: [
      { latitude: 23.80, longitude: 90.36 },
      { latitude: 23.81, longitude: 90.37 }
    ]
  });

  assert.deepEqual(data.features[0].geometry, {
    type: 'LineString',
    coordinates: [[90.36, 23.80], [90.37, 23.81]]
  });
});
