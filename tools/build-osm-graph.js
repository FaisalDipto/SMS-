#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const geo = require('../web/geo.js');

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: node tools/build-osm-graph.js INPUT.osm.xml OUTPUT.json');
  process.exit(1);
}

const xml = fs.readFileSync(inputPath, 'utf8');
const allowedHighways = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'
]);

function attributes(text) {
  const result = {};
  for (const match of text.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    result[match[1]] = match[2];
  }
  return result;
}

const allNodes = new Map();
for (const match of xml.matchAll(/<node\b([^>]*)>/g)) {
  const node = attributes(match[1]);
  if (node.id && node.lat && node.lon) {
    allNodes.set(node.id, {
      latitude: Number(node.lat),
      longitude: Number(node.lon)
    });
  }
}

const graphNodes = {};
const graphEdges = {};
let wayCount = 0;
let edgeCount = 0;

function addEdge(from, to, wayId, segment, direction) {
  if (!graphEdges[from]) graphEdges[from] = [];
  graphEdges[from].push({
    id: `${wayId}:${segment}:${direction}`,
    roadId: wayId,
    to,
    distanceMeters: geo.distanceKm(graphNodes[from], graphNodes[to]) * 1000
  });
  edgeCount += 1;
}

for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
  const wayAttributes = attributes(match[1]);
  const body = match[2];
  const tags = {};
  for (const tagMatch of body.matchAll(/<tag\b([^>]*)\/>/g)) {
    const tag = attributes(tagMatch[1]);
    if (tag.k) tags[tag.k] = tag.v || '';
  }

  if (!wayAttributes.id || !allowedHighways.has(tags.highway)) continue;

  const refs = [...body.matchAll(/<nd\b([^>]*)\/>/g)]
    .map((ndMatch) => attributes(ndMatch[1]).ref)
    .filter((ref) => ref && allNodes.has(ref));
  if (refs.length < 2) continue;

  for (const ref of refs) graphNodes[ref] = allNodes.get(ref);
  const oneway = tags.oneway === 'yes' || tags.oneway === 'true' || tags.oneway === '1' || tags.junction === 'roundabout';
  const reverseOneway = tags.oneway === '-1';

  for (let index = 0; index < refs.length - 1; index += 1) {
    const from = refs[index];
    const to = refs[index + 1];
    if (reverseOneway) {
      addEdge(to, from, wayAttributes.id, index, 'reverse');
    } else {
      addEdge(from, to, wayAttributes.id, index, 'forward');
      if (!oneway) addEdge(to, from, wayAttributes.id, index, 'reverse');
    }
  }
  wayCount += 1;
}

const output = {
  version: 1,
  source: 'OpenStreetMap',
  attribution: '(c) OpenStreetMap contributors',
  coverage: 'Mirpur tile: 90.365E-90.375E, 23.800N-23.810N',
  nodes: graphNodes,
  edges: graphEdges
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output));
const javascriptOutputPath = outputPath.replace(/\.json$/i, '.js');
fs.writeFileSync(
  javascriptOutputPath,
  `window.SMSWeb = window.SMSWeb || {}; window.SMSWeb.routeGraphs = window.SMSWeb.routeGraphs || {}; window.SMSWeb.routeGraphs.mirpur = ${JSON.stringify(output)};`
);
console.log(`nodes=${Object.keys(graphNodes).length}`);
console.log(`ways=${wayCount}`);
console.log(`edges=${edgeCount}`);
console.log(`output=${outputPath}`);
console.log(`javascript=${javascriptOutputPath}`);
