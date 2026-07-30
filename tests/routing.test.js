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

test('blocks road edges intersecting authenticated current hazards', () => {
  const hazards = [{
    hazardId: 'HZD1',
    latitude: 23.8000,
    longitude: 90.3650,
    radiusMeters: 100,
    expiresAt: 1_700_000_060_000,
    authentication: 'AUTHENTICATED'
  }];

  const blocked = routing.blockedEdgesForHazards(graph, hazards, 1_700_000_000_000);
  assert.deepEqual([...blocked], ['AB']);

  const route = routing.shortestPath(
    graph,
    { latitude: 23.8001, longitude: 90.3601 },
    { latitude: 23.8099, longitude: 90.3699 },
    { blockedEdges: blocked }
  );
  assert.deepEqual(route.nodeIds, ['A', 'D', 'C']);
});

test('ignores expired and unauthenticated hazards when blocking roads', () => {
  const records = [{
    latitude: 23.8000,
    longitude: 90.3650,
    radiusMeters: 100,
    expiresAt: 1_699_999_999_000,
    authentication: 'AUTHENTICATED'
  }, {
    latitude: 23.8000,
    longitude: 90.3650,
    radiusMeters: 100,
    expiresAt: 1_700_000_060_000,
    authentication: 'UNVERIFIED'
  }];

  assert.equal(routing.blockedEdgesForHazards(
    graph,
    records,
    1_700_000_000_000
  ).size, 0);
});

test('ranks reachable shelters by actual road-path distance', () => {
  const candidates = routing.fastestReachableDestinations(
    graph,
    { latitude: 23.8000, longitude: 90.3600 },
    [{
      location: 'LONGER',
      coordinate: graph.nodes.C
    }, {
      location: 'FASTER',
      coordinate: graph.nodes.D
    }]
  );

  assert.deepEqual(candidates.map(({ destination }) => destination.location), [
    'FASTER',
    'LONGER'
  ]);
  assert.equal(candidates[0].route.distanceMeters, 1100);
  assert.equal(candidates[1].route.distanceMeters, 2000);
});

test('excludes shelters outside installed road coverage', () => {
  const candidates = routing.fastestReachableDestinations(
    graph,
    graph.nodes.A,
    [{
      location: 'OUTSIDE',
      coordinate: { latitude: 24.1000, longitude: 90.8000 }
    }],
    { maxSnapDistanceMeters: 500 }
  );

  assert.deepEqual(candidates, []);
});
