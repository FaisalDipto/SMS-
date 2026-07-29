#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const [outputPath, ...inputPaths] = process.argv.slice(2);

if (!outputPath || inputPaths.length === 0) {
  console.error('Usage: node tools/merge-route-graphs.js OUTPUT.json INPUT.json...');
  process.exit(1);
}

const merged = {
  version: 1,
  source: 'OpenStreetMap',
  attribution: '(c) OpenStreetMap contributors',
  coverage: 'Mirpur expanded tiles: 90.355E-90.385E, 23.790N-23.820N',
  nodes: {},
  edges: {}
};
const edgeIds = new Set();

for (const inputPath of inputPaths) {
  const graph = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  Object.assign(merged.nodes, graph.nodes);
  for (const [from, edges] of Object.entries(graph.edges)) {
    if (!merged.edges[from]) merged.edges[from] = [];
    for (const edge of edges) {
      if (edgeIds.has(edge.id)) continue;
      edgeIds.add(edge.id);
      merged.edges[from].push(edge);
    }
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(merged));
const javascriptOutputPath = outputPath.replace(/\.json$/i, '.js');
fs.writeFileSync(
  javascriptOutputPath,
  `window.SMSWeb = window.SMSWeb || {}; window.SMSWeb.routeGraphs = window.SMSWeb.routeGraphs || {}; window.SMSWeb.routeGraphs.mirpur = ${JSON.stringify(merged)};`
);

console.log(`nodes=${Object.keys(merged.nodes).length}`);
console.log(`edges=${edgeIds.size}`);
console.log(`output=${outputPath}`);
console.log(`javascript=${javascriptOutputPath}`);
