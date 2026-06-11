// Updated: 2026-06-02
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';
import { hostFooter } from './send-email.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Simple in-memory rate limiter ─────────────────────────
// Limits each IP to 3 party creations per hour.
// Resets on server restart (cold start) — good enough for serverless.
const rateLimitMap = new Map();
const RATE_LIMIT    = 3;
const RATE_WINDOW   = 60 * 60 * 1000; // 1 hour in ms

function isRateLimited(ip) {
  const now  = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

// Escape host-supplied text before placing it in email HTML.
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function sanitiseString(val, maxLen = 200) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function isValidEmail(str) {
  return typeof str === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
}

function isValidAge(val) {
  if (val === null || val === undefined) return true;
  const n = Number(val);
  return Number.isInteger(n) && n >= 1 && n <= 120;
}

function isValidUrl(val) {
  if (!val) return true;
  // http/https only — the URL ends up in <img src> inside emails
  try { return ['http:', 'https:'].includes(new URL(val).protocol); }
  catch { return false; }
}

function isValidPartyDate(val) {
  if (val === null || val === undefined || val === '') return false;
  if (typeof val !== 'string') return false;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return false;
  const now = Date.now();
  const TWO_YEARS = 1000 * 60 * 60 * 24 * 365 * 2;
  return d.getTime() > now - TWO_YEARS && d.getTime() < now + TWO_YEARS;
}

function normalisePartyDate(val) {
  if (val === null || val === undefined || val === '') return null;
  const d = new Date(val);
  return d.toISOString().slice(0, 10);
}

function formatPartyDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return iso; }
}

function confirmationEmailHtml({ child_name, confirm_url, dashboard_token, party_date }) {
  const dateLine = party_date
    ? `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 18px;">📅 <strong>${formatPartyDate(party_date)}</strong></p>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:16px;">
    <span style="font-family:Georgia,serif;font-size:1.2rem;font-style:italic;color:#c9a84c;">Tiny Invites</span>
  </td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:14px;overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:32px 40px 36px;">
        <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">Almost there ✦</p>
        <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.3;">Confirm your email to go live</h1>
        <p style="font-size:0.87rem;color:#6b5c45;line-height:1.7;margin:0 0 18px;">
          You're one step away from publishing <strong>${esc(child_name)}'s</strong> party page.
          Click the button below to confirm your email address and make your RSVP page live.
        </p>
        ${dateLine}
        <p style="font-size:0.82rem;color:#a89880;margin:0 0 24px;">
          Nothing goes live until you confirm. If you didn't create this party, you can safely ignore this email.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
          <a href="${confirm_url}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">Yes, make my party live</a>
        </td></tr></table>
        <p style="font-size:0.75rem;color:#a89880;margin:18px 0 0;text-align:center;">
          Or copy this link: <a href="${confirm_url}" style="color:#a89880;">${confirm_url}</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;padding:20px 0 0;">
    <p style="font-size:0.68rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span></p>
  </td></tr>
  ${hostFooter(dashboard_token)}
</table>
</td></tr></table></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};

    // ── Honeypot — bots fill this hidden field, humans don't ─
    if (body.website) {
      // Return 200 so bots think it worked
      return res.status(200).json({ success: true, message: 'Check your email to confirm and go live' });
    }

    // ── Rate limiting ─────────────────────────────────────
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many requests — please try again later.' });
    }

    // ── Validation ────────────────────────────────────────
    const child_name   = sanitiseString(body.child_name, 100);
    const parent_email = typeof body.parent_email === 'string'
      ? body.parent_email.trim().toLowerCase()
      : null;

    if (!child_name) {
      return res.status(400).json({ error: 'Missing or empty child_name' });
    }
    if (!parent_email) {
      return res.status(400).json({ error: 'Missing parent_email' });
    }
    if (!isValidEmail(parent_email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const age            = body.age !== undefined ? Number(body.age) : null;
    const venue          = sanitiseString(body.venue, 200);
    const special_note   = sanitiseString(body.special_note, 500);
    const photo_url      = sanitiseString(body.photo_url, 500);
    const party_date_raw = body.party_date !== undefined ? body.party_date : null;
    const count_adults     = body.count_adults === true || body.count_adults === 'true';
    const count_babies     = body.count_babies === true || body.count_babies === 'true';
    const rsvp_cutoff_raw  = body.rsvp_cutoff || null;

    if (age !== null && !isValidAge(age)) {
      return res.status(400).json({ error: 'Invalid age — must be between 1 and 120' });
    }
    if (!isValidUrl(photo_url)) {
      return res.status(400).json({ error: 'Invalid photo_url' });
    }
    if (!isValidPartyDate(party_date_raw)) {
      return res.status(400).json({ error: 'Invalid party_date — must be a date within 2 years of today' });
    }
    const party_date   = normalisePartyDate(party_date_raw);
    // rsvp_cutoff must be a valid date before or equal to the party date
    let rsvp_cutoff = (rsvp_cutoff_raw && isValidPartyDate(rsvp_cutoff_raw))
      ? normalisePartyDate(rsvp_cutoff_raw)
      : null;
    if (rsvp_cutoff && party_date && rsvp_cutoff > party_date) {
      return res.status(400).json({ error: 'rsvp_cutoff cannot be after the party date' });
    }

    // ── Duplicate check ───────────────────────────────────
    // Same email + same date = almost certainly a double submission.
    // Only block if the existing party is unconfirmed (still pending) or
    // confirmed. If they genuinely have two parties on the same day, they
    // can contact support.
    const { data: existing } = await supabase
      .from('parties')
      .select('party_id, confirmed')
      .eq('parent_email', parent_email)
      .eq('party_date', party_date)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: 'A party for this email and date already exists. Check your inbox for the confirmation link, or contact us if you need help.',
      });
    }

    // ── Generate IDs ──────────────────────────────────────
    const party_id        = randomUUID();
    const dashboard_token = randomUUID();

    // ── Insert party as unconfirmed ───────────────────────
    const { error: dbError } = await supabase
      .from('parties')
      .insert([{
        party_id,
        dashboard_token,
        child_name,
        age,
        venue,
        parent_email,
        photo_url,
        special_note,
        party_date,
        count_adults,
        count_babies,
        rsvp_cutoff,
        confirmed: false,
      }]);

    if (dbError) {
      console.error('DB insert error:', dbError.message);
      return res.status(500).json({ error: 'Failed to save party' });
    }

    // ── Send confirmation email to host ───────────────────
    const confirm_url = `https://tinyinvites.org/confirm.html?token=${dashboard_token}`;

    try {
      await resend.emails.send({
        from:    'Tiny Invites <hello@tinyinvites.org>',
        to:      parent_email,
        subject: `Confirm your email to publish ${child_name}'s party`,
        html:    confirmationEmailHtml({ child_name, confirm_url, dashboard_token, party_date }),
      });
    } catch (emailErr) {
      console.error('Confirmation email failed:', emailErr.message);
    }

    // ── Admin notification ────────────────────────────────
    try {
      await resend.emails.send({
        from:    'Tiny Invites <hello@tinyinvites.org>',
        to:      'hello@tinyinvites.org',
        subject: `🎉 New party created — ${child_name}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#2a2218;line-height:1.8;">
          <strong>New party submitted</strong><br/><br/>
          👶 <strong>Child:</strong> ${esc(child_name)}${age ? `, turning ${ordinal(age)}` : ''}<br/>
          📅 <strong>Date:</strong> ${formatPartyDate(party_date)}<br/>
          📍 <strong>Venue:</strong> ${venue ? esc(venue) : '—'}<br/>
          ✉️ <strong>Host:</strong> ${parent_email}<br/>
          🔑 <strong>Party ID:</strong> ${party_id}<br/>
          🌐 <strong>IP:</strong> ${ip}<br/><br/>
          Status: <strong>awaiting email confirmation</strong>
        </p>`,
      });
    } catch (adminErr) {
      console.error('Admin notification failed:', adminErr.message);
    }

    return res.status(200).json({
      success: true,
      party_id,
      message: 'Check your email to confirm and go live',
    });

  } catch (err) {
    console.error('go-live error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
