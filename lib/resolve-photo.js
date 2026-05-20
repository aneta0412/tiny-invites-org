// Updated: 2026-05-20
// netlify/functions/resolve-photo.js
// Place at: netlify/functions/resolve-photo.js
// Route:    /api/resolve-photo?url=...

export default async (req, context) => {
  const url = new URL(req.url).searchParams.get('url');

  if (!url) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const allowed = ['photos.app.goo.gl', 'photos.google.com', 'lh3.googleusercontent.com'];
  if (!allowed.some(d => url.includes(d))) {
    return new Response(JSON.stringify({ error: 'Only Google Photos links are supported' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  // Direct lh3 URL — clean size suffix and return immediately
  if (url.includes('lh3.googleusercontent.com')) {
    const clean = url.replace(/=w\d+.*$|=h\d+.*$|=s\d+.*$/, '') + '=w1200';
    return new Response(JSON.stringify({ image_url: clean }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const html = await res.text();

    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

    if (!match?.[1]) throw new Error('No image found in page');

    const imageUrl = match[1].replace(/=w\d+.*$|=h\d+.*$|=s\d+.*$/, '') + '=w1200';

    return new Response(JSON.stringify({ image_url: imageUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to resolve photo' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/api/resolve-photo' };
