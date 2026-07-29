const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serviceWorker = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'sw.js'),
  'utf8'
);

test('service worker caches every current application-shell asset', () => {
  for (const asset of [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './protocol.js',
    './storage.js',
    './renderer.js',
    './simulator.js',
    './sw.js'
  ]) {
    assert.match(serviceWorker, new RegExp(`['"]${asset.replace('./', '\\./')}['"]`));
  }
});

test('service worker uses cache-first fetch handling and removes old caches', () => {
  assert.match(serviceWorker, /caches\.match\(event\.request\)/);
  assert.match(serviceWorker, /cache\.put\(event\.request/);
  assert.match(serviceWorker, /cacheNames\s+\.filter/);
  assert.match(serviceWorker, /event\.request\.method !== 'GET'/);
});
