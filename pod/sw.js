const CACHE = 'tinybooth-v15';
const FILES = ['./', './index.html', './manifest.json', './icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  const base = new URL('./', self.location).pathname;      // e.g. /pod/
  // never touch another origin (Cloudinary) and never touch the rest of the site
  if (u.origin !== self.location.origin || u.pathname.indexOf(base) !== 0) return;
  const isPage = e.request.mode === 'navigate' || u.pathname === base || u.pathname.slice(-11) === '/index.html';
  if (isPage) {
    // online you always get the newest booth; offline you get the cached one
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res;
    }).catch(() => caches.match('./index.html')));
  } else {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    })));
  }
});
