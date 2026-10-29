const CACHE = "o3dview-web-v52";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./src/app.js",
  "./src/o3d.js",
  "./src/scene.js",
  "./src/renderer.js",
  "./src/renderer-selection.js",
  "./src/webgl-renderer.js",
  "./src/dds.js",
  "./src/tga.js",
  "./src/obj.js",
  "./src/obj-export.js",
  "./src/config-inspector.js",
  "./src/cfg-materials.js",
  "./src/scene-variables.js",
  "./src/scene-visibility.js",
  "./src/scene-transforms.js",
  "./src/camera-controls.js",
  "./src/picking.js",
  "./src/drop-files.js",
  "./src/o3d-write.js",
  "./src/interior-lights.js",
  "./src/light-data.js",
  "./src/global-materials.js",
  "./src/map-tile.js",
  "./src/map-transform.js",
  "./src/spline.js",
  "./src/cabin-path.js",
  "./src/repaints.js",
  "./src/repaint-session.js",
  "./src/dropdowns.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          ASSETS.map((path) => new Request(path, { cache: "reload" })),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("o3dview-web-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    !event.request.url.startsWith(self.registration.scope)
  )
    return;
  event.respondWith(
    caches
      .match(event.request)
      .then((cached) => cached || fetch(event.request)),
  );
});
