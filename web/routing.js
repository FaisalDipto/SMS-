(function attachRouting(root, factory) {
  const geo = root?.SMSWeb?.geo || (typeof require === 'function' ? require('./geo.js') : undefined);
  const routing = factory(geo);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = routing;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.routing = routing;
  }
})(typeof window !== 'undefined' ? window : globalThis, (geo) => {
  'use strict';

  function requireGraph(graph) {
    if (!graph || typeof graph.nodes !== 'object' || typeof graph.edges !== 'object') {
      throw new Error('Routing graph must contain nodes and edges');
    }
  }

  function nodeCoordinate(graph, nodeId) {
    const node = graph.nodes[nodeId];
    if (!node || !Number.isFinite(node.latitude) || !Number.isFinite(node.longitude)) {
      throw new Error(`Routing graph node is invalid: ${nodeId}`);
    }
    return node;
  }

  function edgeDistanceMeters(graph, fromId, edge) {
    if (!edge || typeof edge.to !== 'string') {
      throw new Error(`Routing graph edge from ${fromId} is invalid`);
    }
    if (edge.distanceMeters !== undefined) {
      if (!Number.isFinite(edge.distanceMeters) || edge.distanceMeters < 0) {
        throw new Error(`Routing graph edge from ${fromId} has invalid distance`);
      }
      return edge.distanceMeters;
    }
    if (!geo) {
      throw new Error('Geographic distance support is unavailable');
    }
    return geo.distanceKm(nodeCoordinate(graph, fromId), nodeCoordinate(graph, edge.to)) * 1000;
  }

  function findNearestNode(graph, coordinate) {
    requireGraph(graph);
    if (!geo) throw new Error('Geographic distance support is unavailable');

    let nearest;
    for (const nodeId of Object.keys(graph.nodes)) {
      const node = nodeCoordinate(graph, nodeId);
      const distanceMeters = geo.distanceKm(coordinate, node) * 1000;
      if (!nearest || distanceMeters < nearest.distanceMeters) {
        nearest = { nodeId, distanceMeters };
      }
    }
    return nearest;
  }

  function distanceFromHazardToEdgeMeters(graph, fromId, edge, hazard) {
    const from = nodeCoordinate(graph, fromId);
    const to = nodeCoordinate(graph, edge.to);
    const latitudeRadians = hazard.latitude * Math.PI / 180;
    const metresPerLongitude = 111_320 * Math.cos(latitudeRadians);
    const metresPerLatitude = 110_540;
    const start = {
      x: (from.longitude - hazard.longitude) * metresPerLongitude,
      y: (from.latitude - hazard.latitude) * metresPerLatitude
    };
    const end = {
      x: (to.longitude - hazard.longitude) * metresPerLongitude,
      y: (to.latitude - hazard.latitude) * metresPerLatitude
    };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(start.x * dx + start.y * dy) / lengthSquared));
    const nearestX = start.x + projection * dx;
    const nearestY = start.y + projection * dy;
    return Math.hypot(nearestX, nearestY);
  }

  function blockedEdgesForHazards(graph, hazards, now = Date.now()) {
    requireGraph(graph);
    const activeHazards = (Array.isArray(hazards) ? hazards : []).filter((hazard) =>
      String(hazard.authentication || '').toUpperCase() === 'AUTHENTICATED' &&
      Number.isFinite(hazard.expiresAt) && hazard.expiresAt > now &&
      Number.isFinite(hazard.latitude) && Number.isFinite(hazard.longitude) &&
      Number.isFinite(hazard.radiusMeters) && hazard.radiusMeters > 0);
    const blockedEdges = new Set();

    for (const [fromId, edges] of Object.entries(graph.edges)) {
      for (const edge of edges || []) {
        if (!edge.id) continue;
        if (activeHazards.some((hazard) =>
          distanceFromHazardToEdgeMeters(graph, fromId, edge, hazard) <= hazard.radiusMeters
        )) {
          blockedEdges.add(edge.id);
        }
      }
    }
    return blockedEdges;
  }

  class MinHeap {
    constructor() {
      this.items = [];
    }

    push(item) {
      this.items.push(item);
      this.bubbleUp(this.items.length - 1);
    }

    pop() {
      if (this.items.length === 0) return undefined;
      const first = this.items[0];
      const last = this.items.pop();
      if (this.items.length > 0) {
        this.items[0] = last;
        this.sinkDown(0);
      }
      return first;
    }

    bubbleUp(index) {
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (this.items[parent].priority <= this.items[index].priority) break;
        [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
        index = parent;
      }
    }

    sinkDown(index) {
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) {
          smallest = left;
        }
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) {
          smallest = right;
        }
        if (smallest === index) break;
        [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
        index = smallest;
      }
    }
  }

  function shortestPath(graph, origin, destination, { blockedEdges = new Set() } = {}) {
    requireGraph(graph);
    if (!geo) throw new Error('Geographic distance support is unavailable');

    const start = findNearestNode(graph, origin);
    const target = findNearestNode(graph, destination);
    const distances = new Map([[start.nodeId, 0]]);
    const previous = new Map();
    const queue = new MinHeap();
    queue.push({ nodeId: start.nodeId, priority: 0 });

    while (true) {
      const current = queue.pop();
      if (!current) break;
      if (current.priority !== distances.get(current.nodeId)) continue;
      if (current.nodeId === target.nodeId) break;

      for (const edge of graph.edges[current.nodeId] || []) {
        if (edge.id && blockedEdges.has(edge.id)) continue;
        const edgeDistance = edgeDistanceMeters(graph, current.nodeId, edge);
        const candidate = current.priority + edgeDistance;
        if (candidate >= (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
        distances.set(edge.to, candidate);
        previous.set(edge.to, { nodeId: current.nodeId, edge });
        queue.push({ nodeId: edge.to, priority: candidate });
      }
    }

    if (!distances.has(target.nodeId)) {
      throw new Error('No available route connects the selected locations');
    }

    const nodeIds = [];
    const pathEdges = [];
    for (let nodeId = target.nodeId; nodeId; ) {
      nodeIds.unshift(nodeId);
      const step = previous.get(nodeId);
      if (!step) break;
      pathEdges.unshift({ ...step.edge, from: step.nodeId });
      nodeId = step.nodeId;
    }

    return {
      distanceMeters: distances.get(target.nodeId) + start.distanceMeters + target.distanceMeters,
      nodeIds,
      coordinates: [
        { latitude: origin.latitude, longitude: origin.longitude },
        ...nodeIds.map((nodeId) => nodeCoordinate(graph, nodeId)),
        { latitude: destination.latitude, longitude: destination.longitude }
      ],
      edges: pathEdges,
      roadNames: [...new Set(pathEdges.map((edge) => edge.roadName).filter(Boolean))],
      originSnap: start,
      destinationSnap: target
    };
  }

  return Object.freeze({
    findNearestNode,
    blockedEdgesForHazards,
    distanceFromHazardToEdgeMeters,
    shortestPath
  });
});
