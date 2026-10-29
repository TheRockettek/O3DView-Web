import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function worker() {
  const handlers = {};
  const state = { cached: [], cacheModes: [], deleted: [], claimed: false, skipped: false };
  const self = {
    registration: { scope: 'http://localhost:8000/' },
    clients: { claim: async () => { state.claimed = true; } },
    skipWaiting: async () => { state.skipped = true; },
    addEventListener: (name, handler) => { handlers[name] = handler; }
  };
  const caches = {
    open: async () => ({ addAll: async assets => {
      state.cached = assets.map(request => request.url);
      state.cacheModes = assets.map(request => request.cache);
    } }),
    keys: async () => ['o3dview-web-v51', 'o3dview-web-v52', 'unrelated'],
    delete: async key => { state.deleted.push(key); },
    match: async request => request.url.endsWith('/index.html') ? 'cached page' : undefined
  };
  const fetch = async () => 'network response';
  class Request {
    constructor(url, options) { this.url = url; this.cache = options.cache; }
  }
  runInNewContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), { self, caches, fetch, Request });
  return { handlers, state };
}

test('installation caches all real application files', async () => {
  const { handlers, state } = await worker();
  let pending;
  handlers.install({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.ok(state.skipped);
  assert.ok(state.cacheModes.every(mode => mode === 'reload'));
  assert.ok(state.cached.includes('./src/renderer.js'));
  assert.ok(state.cached.includes('./src/renderer-selection.js'));
  assert.ok(state.cached.includes('./src/webgl-renderer.js'));
  assert.ok(state.cached.includes('./src/config-inspector.js'));
  assert.ok(state.cached.includes('./src/cfg-materials.js'));
  assert.ok(state.cached.includes('./src/scene-variables.js'));
  assert.ok(state.cached.includes('./src/scene-visibility.js'));
  assert.ok(state.cached.includes('./src/scene-transforms.js'));
  assert.ok(state.cached.includes('./src/camera-controls.js'));
  assert.ok(state.cached.includes('./src/drop-files.js'));
  assert.ok(state.cached.includes('./src/o3d.js'));
  assert.ok(state.cached.includes('./src/scene.js'));
  assert.ok(state.cached.includes('./src/dds.js'));
  assert.ok(state.cached.includes('./src/tga.js'));
  assert.ok(state.cached.includes('./src/obj.js'));
  assert.ok(state.cached.includes('./src/obj-export.js'));
  assert.ok(state.cached.includes('./src/o3d-write.js'));
  assert.ok(state.cached.includes('./src/interior-lights.js'));
  assert.ok(state.cached.includes('./src/light-data.js'));
  assert.ok(state.cached.includes('./src/global-materials.js'));
  assert.ok(state.cached.includes('./src/map-tile.js'));
  assert.ok(state.cached.includes('./src/map-transform.js'));
  assert.ok(state.cached.includes('./src/spline.js'));
  assert.ok(state.cached.includes('./src/cabin-path.js'));
  assert.ok(state.cached.includes('./src/repaints.js'));
  assert.ok(state.cached.includes('./src/repaint-session.js'));
  assert.ok(state.cached.includes('./src/dropdowns.js'));
  for (const asset of state.cached) {
    await access(new URL(asset === './' ? '../index.html' : `../${asset.slice(2)}`, import.meta.url));
  }
});

test('activation only deletes old application caches', async () => {
  const { handlers, state } = await worker();
  let pending;
  handlers.activate({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.deepEqual(state.deleted, ['o3dview-web-v51']);
  assert.ok(state.claimed);
});

test('fetch serves cached files, falls back to network, and ignores other origins', async () => {
  const { handlers } = await worker();
  let response;
  handlers.fetch({ request: { method: 'GET', url: 'http://localhost:8000/index.html' }, respondWith: value => { response = value; } });
  assert.equal(await response, 'cached page');
  handlers.fetch({ request: { method: 'GET', url: 'http://localhost:8000/missing' }, respondWith: value => { response = value; } });
  assert.equal(await response, 'network response');
  response = undefined;
  handlers.fetch({ request: { method: 'GET', url: 'https://example.com/index.html' }, respondWith: value => { response = value; } });
  assert.equal(response, undefined);
});
