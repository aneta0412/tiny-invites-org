// Tiny Invites photo booth: keeps the booth pages on the iPad so they open instantly
// and keep working when the venue internet is slow or drops out.
const CACHE = 'ti-pod-v32';
const PAGES = ['express.html', 'index.html', './'];
// the guest book PDF tool is fetched once from this address, then kept for offline use
const KEEP_EXTERNAL = ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/'];

// A page that reached us through a redirect cannot be used to open the booth later
// (Safari refuses it), so every saved page is stored as a plain, clean copy.
async function clean(r) {
  if (!r || !r.redirected) return r;
  const body = await r.blob();
  return new Response(body, { status:r.status, statusText:r.statusText, headers:r.headers });
}
async function save(cache, key, r) { if (r && r.ok) await cache.put(key, await clean(r.clone())); }

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PAGES.map(p => fetch(new Request(p, { cache:'reload' })).then(r => save(cache, p, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('ti-pod-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    if (KEEP_EXTERNAL.some(p => req.url.startsWith(p))) e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; })));
    return;   // uploads, Cloudinary and everything else go straight to the internet
  }
  // Pages: try the internet for a fresh copy, but never wait more than 3 seconds for it.
  if (req.mode === 'navigate' || /\.html$|\/$/.test(url.pathname)) {
    let key = url.pathname.replace(/^.*\//, '') || './';
    if (key !== './' && !/\.[a-z0-9]+$/i.test(key)) key += '.html';      // /pod/express works like /pod/express.html
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(key) || await cache.match(req, { ignoreSearch:true });
      const net = fetch(req).then(async r => { if (!r || !r.ok) throw new Error('bad'); if (!url.search) await save(cache, key, r); return clean(r); });
      if (!saved) return net.catch(() => new Response('<h1 style="font-family:sans-serif">No internet, and the booth is not saved on this iPad yet.</h1><p style="font-family:sans-serif">Open it once with internet, then it works offline.</p>', { status:503, headers:{ 'Content-Type':'text/html; charset=utf-8' } }));
      return Promise.race([net.catch(() => saved), new Promise(r => setTimeout(() => r(saved), 3000))]);
    })());
    return;
  }
  // anything else from this site: the saved copy first, then the internet
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })));
});
