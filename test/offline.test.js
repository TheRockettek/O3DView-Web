import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

async function worker() {
  const handlers = {};
  const state = {
    cached: [],
    cacheModes: [],
    deleted: [],
    claimed: false,
    skipped: false,
  };
  const self = {
    registration: { scope: "http://localhost:8000/" },
    clients: {
      claim: async () => {
        state.claimed = true;
      },
    },
    skipWaiting: async () => {
      state.skipped = true;
    },
    addEventListener: (name, handler) => {
      handlers[name] = handler;
    },
  };
  const caches = {
    open: async () => ({
      addAll: async (assets) => {
        state.cached = assets.map((request) => request.url);
        state.cacheModes = assets.map((request) => request.cache);
      },
    }),
    keys: async () => ["o3dview-web-v51", "o3dview-web-v52", "unrelated"],
    delete: async (key) => {
      state.deleted.push(key);
    },
    match: async (request) =>
      request.url.endsWith("/index.html") ? "cached page" : undefined,
  };
  const fetch = async () => "network response";
  class Request {
    constructor(url, options) {
      this.url = url;
      this.cache = options.cache;
    }
  }
  runInNewContext(
    await readFile(new URL("../sw.js", import.meta.url), "utf8"),
    { self, caches, fetch, Request },
  );
  return { handlers, state };
}

test("installation caches all real application files", async () => {
  const { handlers, state } = await worker();
  let pending;
  handlers.install({
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await pending;
  assert.ok(state.skipped);
  assert.ok(state.cacheModes.every((mode) => mode === "reload"));
  for (const asset of state.cached) {
    await access(
      new URL(
        asset === "./" ? "../index.html" : `../${asset.slice(2)}`,
        import.meta.url,
      ),
    );
  }

  const projectRoot = new URL("../", import.meta.url);
  const cached = new Set(
    state.cached.map((asset) => new URL(asset, projectRoot).href),
  );
  const modulesToVisit = [new URL("../src/app.js", import.meta.url)];
  const visited = new Set();
  while (modulesToVisit.length) {
    const moduleUrl = modulesToVisit.pop();
    if (visited.has(moduleUrl.href)) continue;
    visited.add(moduleUrl.href);
    const source = await readFile(moduleUrl, "utf8");
    const imports = source.matchAll(
      /^\s*import\s+(?:[\w$,\s{}*]+?\s+from\s+)?(['"])(\.[^'"]+)\1\s*;?/gm,
    );
    for (const [, , specifier] of imports) {
      const dependency = new URL(specifier, moduleUrl);
      assert.ok(
        cached.has(dependency.href),
        `${dependency.pathname} is imported but not precached`,
      );
      modulesToVisit.push(dependency);
    }
  }
});

test("activation only deletes old application caches", async () => {
  const { handlers, state } = await worker();
  let pending;
  handlers.activate({
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await pending;
  assert.deepEqual(state.deleted, ["o3dview-web-v51", "o3dview-web-v52"]);
  assert.ok(state.claimed);
});

test("fetch serves cached files, falls back to network, and ignores other origins", async () => {
  const { handlers } = await worker();
  let response;
  handlers.fetch({
    request: { method: "GET", url: "http://localhost:8000/index.html" },
    respondWith: (value) => {
      response = value;
    },
  });
  assert.equal(await response, "cached page");
  handlers.fetch({
    request: { method: "GET", url: "http://localhost:8000/missing" },
    respondWith: (value) => {
      response = value;
    },
  });
  assert.equal(await response, "network response");
  response = undefined;
  handlers.fetch({
    request: { method: "GET", url: "https://example.com/index.html" },
    respondWith: (value) => {
      response = value;
    },
  });
  assert.equal(response, undefined);
});
