const test = require('node:test');
const assert = require('node:assert/strict');

const routing = require('../web/routing.js');

const graph = {
  nodes: {
    A: { latitude: 23.8000, longitude: 90.3600 },
    B: { latitude: 23.8000, longitude: 90.3700 },
    C: { latitude: 23.8100, longitude: 90.3700 },
    D: { latitude: 23.8100, longitude: 90.3600 }
  },
  edges: {
    A: [{ id: 'AB', to: 'B', distanceMeters: 1000, roadName: 'Mirpur Road' }, { id: 'AD', to: 'D', distanceMeters: 1100, roadName: 'Alternative Road' }],
    B: [{ id: 'BC', to: 'C', distanceMeters: 1000, roadName: 'Kazipara Road' }],
    C: [{ id: 'CD', to: 'D', distanceMeters: 1000 }],
    D: [{ id: 'DC', to: 'C', distanceMeters: 1000 }]
  }
};

test('finds the shortest available path in an offline graph', () => {
  const route = routing.shortestPath(
    graph,
    { latitude: 23.8001, longitude: 90.3601 },
    { latitude: 23.8099, longitude: 90.3699 }
  );

  assert.deepEqual(route.nodeIds, ['A', 'B', 'C']);
  assert.deepEqual(route.roadNames, ['Mirpur Road', 'Kazipara Road']);
  assert.equal(route.coordinates.length, 5);
  assert.equal(route.distanceMeters,
    2000 + route.originSnap.distanceMeters + route.destinationSnap.distanceMeters);
});

test('avoids a blocked edge and reports the longer safe path', () => {
  const route = routing.shortestPath(
    graph,
    { latitude: 23.8001, longitude: 90.3601 },
    { latitude: 23.8099, longitude: 90.3699 },
    { blockedEdges: new Set(['BC']) }
  );

  assert.deepEqual(route.nodeIds, ['A', 'D', 'C']);
  assert.equal(route.distanceMeters,
    2100 + route.originSnap.distanceMeters + route.destinationSnap.distanceMeters);
});

test('rejects disconnected destinations', () => {
  assert.throws(() => routing.shortestPath(
    { nodes: { A: graph.nodes.A, B: graph.nodes.B }, edges: { A: [], B: [] } },
    graph.nodes.A,
    graph.nodes.B
  ), /No available route/);
});
