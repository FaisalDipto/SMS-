const test = require('node:test');
const assert = require('node:assert/strict');

const admin = require('../web/admin.js');

test('serializes authority form values with numeric fields preserved', () => {
  const form = {
    elements: [
      { name: 'location', type: 'text', value: ' MIRPUR ' },
      { name: 'spaces', type: 'number', value: '85' },
      { name: 'latitude', type: 'number', value: '23.8069' },
      { name: '', type: 'submit', value: '' }
    ]
  };

  assert.deepEqual(admin.payloadFor(form), {
    location: 'MIRPUR',
    spaces: 85,
    latitude: 23.8069
  });
});
