TINY INVITES — FILES TO UPLOAD
==============================

Everything in this folder is ready to go live. Upload each file to the matching
location on your site (same place index.html already lives = the "web root").

WEB ROOT  (same folder as index.html and partyfinder.html)
----------------------------------------------------------
robots.txt            -> tinyinvites.org/robots.txt
sitemap.xml           -> tinyinvites.org/sitemap.xml          (the index — submit THIS one in Google Search Console)
sitemap-pages.xml     -> tinyinvites.org/sitemap-pages.xml    (homepage, create-invitations/designs, party finder, shop)
sitemap-venues.xml    -> tinyinvites.org/sitemap-venues.xml   (all 315 open venue pages)
og-partyfinder.jpg    -> tinyinvites.org/og-partyfinder.jpg   (social share image used by partyfinder.html)
partyfinder.html      -> tinyinvites.org/partyfinder.html     (REPLACE existing — adds meta/OG tags + venue structured data)
venue.html            -> tinyinvites.org/venue.html           (REPLACE existing — fixes the canonical URL to the working path)

API  (the /api folder, NOT the root)
-------------------------------------
api/venues.js         -> /api/venues.js                       (REPLACE existing — now only returns open venues)

WHY THESE
---------
- robots.txt + the 3 sitemaps must sit at the root or Google can't find them.
- sitemap.xml lists the other two sitemaps; you only submit sitemap.xml.
- The sitemap covers every public page: the homepage (where invitations are
  created), the designs/create-invitations page, the party finder, the shop,
  and all 315 individual venue pages.

AFTER UPLOADING — quick checks
------------------------------
Open each in a browser; all should load (not 404):
  tinyinvites.org/robots.txt
  tinyinvites.org/sitemap.xml
  tinyinvites.org/og-partyfinder.jpg
Then in Google Search Console -> Sitemaps, submit:  sitemap.xml

NOT in this folder (database-only, run in Supabase if you want):
  cleanup_duplicate_venue.sql   -> removes the one duplicate venue (id 252)
  (do NOT run insert_venues.sql — those venues already exist)
