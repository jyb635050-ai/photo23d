const CACHE = "photo23d-v15";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./favicon.svg",
  "./app.js",
  "./src/reconstruct-worker.js",
  "./src/core/visual-hull.js",
  "./src/core/mask-postprocess.js",
  "./src/core/mesh-export.js",
  "./vendor/three.module.js",
  "./vendor/three.core.js",
  "./vendor/isosurface.mjs",
  "./vendor/fflate.mjs",
  "./vendor/transformers.min.js",
  "./vendor/ort-wasm-simd-threaded.jsep.mjs",
  "./vendor/ort-wasm-simd-threaded.jsep.wasm",
  "./models/briaai/RMBG-1.4/config.json",
  "./models/briaai/RMBG-1.4/preprocessor_config.json",
  "./models/briaai/RMBG-1.4/onnx/model_quantized.onnx",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    }),
  );
});

