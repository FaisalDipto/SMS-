const test = require('node:test');
const assert = require('node:assert/strict');

const hazards = require('../web/hazards.js');

test('parses compact authenticated hazard payload records', () => {
  assert.deepEqual(
    hazards.parseHazardPayload('HZD1:C:23.8125:90.3687:90:H:Mirpur_local_road'),
    [{
      hazardId: 'HZD1',
      kind: 'ROAD_CLOSED',
      latitude: 23.8125,
      longitude: 90.3687,
      radiusMeters: 90,
      severity: 'HIGH',
      roadName: 'Mirpur local road'
    }]
  );
});

test('rejects malformed hazard payloads', () => {
  assert.throws(() => hazards.parseHazardPayload('HZD1:C:23.8:90.3'), /must use/);
  assert.throws(
    () => hazards.parseHazardPayload('HZD1:X:23.8:90.3:50:H:Road'),
    /kind or severity/
  );
  assert.throws(
    () => hazards.parseHazardPayload('HZD1:C:93:90.3:50:H:Road'),
    /coordinates/
  );
});
