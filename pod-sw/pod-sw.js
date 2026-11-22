// Tiny Invites photo booth: keeps the booth pages on the iPad so they open instantly
// and keep working when the venue internet is slow or drops out.
const CACHE = 'ti-pod-v30';
const PAGES = ['./', 'index.html', 'express.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PAGES.map(p => c.add(new Request(p, { cache:'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ti-pod-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Pages: try the network for a fresh copy, but never wait more than 3 seconds for it.
// Anything else from this site: the saved copy first.
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate' || /\.html$|\/$/.test(url.pathname)) {
    const key = url.pathname.replace(/^.*\//, '') || './';
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(key, { ignoreSearch:true }) || await cache.match(req, { ignoreSearch:true });
      if (!saved) return fetch(req).then(r => { if (r && r.ok && !url.search) cache.put(key, r.clone()); return r; });
      const net = fetch(req).then(r => { if (!r || !r.ok) throw new Error('bad'); if (!url.search) cache.put(key, r.clone()); return r; });
      net.catch(() => {});
      return Promise.race([net.catch(() => saved), new Promise(r => setTimeout(() => r(saved), 3000))]);
    })());
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
