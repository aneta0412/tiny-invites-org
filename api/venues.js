// Updated: 2026-06-15
// api/venues.js
//
// Public GET — returns the Party Finder venue list from Supabase, mapped to the
// exact shape partyfinder.html expects (the old inline `DB` array). Columns are
// snake_case in the DB; this maps them back to the camelCase keys the front-end
// uses. packages/extras are JSONB and pass straight through.
//
// Route: GET /api/venues

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function toFrontend(r) {
  return {
    id:        r.id,
    cat:       r.cat,
    name:      r.name,
    h1:        r.h1,    // h1/h2/h3 + meta* unused by the finder grid today,
    h2:        r.h2,    // but returned so future per-venue SEO pages can use them.
    h3:        r.h3,
    metaTitle: r.meta_title,
    metaDesc:  r.meta_desc,
    sub:       r.sub,
    postcode:  r.postcode,
    city:      r.city,
    slug:      r.slug,
    type:      r.type,
    lat:       r.lat,
    lng:       r.lng,
    ages:      r.ages,
    maxKids:   r.max_kids,
    duration:  r.duration,
    loc:       r.loc,
    food:      r.food,
    bags:      r.bags,
    shortDesc: r.short_desc,
    packages:  Array.isArray(r.packages) ? r.packages : [],
    extras:    Array.isArray(r.extras)   ? r.extras   : [],
    notes:     r.notes,
    website:   r.website,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('venues')
      .select('*')
      .eq('is_open', true)
      .order('id', { ascending: true });

    if (error) {
      console.error('[venues] query error:', error.message);
      return res.status(500).json({ error: 'Failed to load venues' });
    }

    // Cache at the CDN — venue data changes rarely. 5 min fresh, 1 h stale.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ venues: (data || []).map(toFrontend) });

  } catch (err) {
    console.error('[venues] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
