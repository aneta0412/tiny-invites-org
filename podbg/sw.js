const CACHE = 'tinybooth-podbg-v17';
const PREFIX = 'tinybooth-podbg-';
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/';
const FILES = ['./', './index.html', './manifest.json', './icon.png'];
// the AI backdrop model, so it works with no internet at the venue
const AI = ['selfie_segmentation.js', 'selfie_segmentation_solution_simd_wasm_bin.js',
            'selfie_segmentation_solution_simd_wasm_bin.wasm', 'selfie_segmentation_solution_simd_wasm_bin.data',
            'selfie_segmentation.binarypb', 'selfie_segmentation.tflite',
            'selfie_segmentation_landscape.tflite'].map(f => MP + f);
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES).then(() => { c.addAll(AI).catch(() => {}); }))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.indexOf(PREFIX) === 0 && x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) {
    if (e.request.url.indexOf(MP) === 0) {
      e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
      })));
    }
    return;   // everything else, Cloudinary included, goes straight to the network
  }
  const base = new URL('./', self.location).pathname;
  if (u.pathname.indexOf(base) !== 0) return;
  const isPage = e.request.mode === 'navigate' || u.pathname === base || u.pathname.slice(-11) === '/index.html';
  if (isPage) {
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res;
    }).catch(() => caches.match('./index.html')));
  } else {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    })));
  }
});
