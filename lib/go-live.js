// Updated: 2026-06-02
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';
import { hostFooter } from './send-email.js';
import { enforceRateLimit } from './rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

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

// Loose phone validation — accepts digits, spaces, +, -, (), of a sane length.
// Not strictly E.164; hosts enter all sorts of UK/international formats.
function isValidPhoneNumber(val) {
  if (!val) return true;
  const trimmed = String(val).trim();
  if (!/^[0-9+\-\s()]{6,20}$/.test(trimmed)) return false;
  const digitCount = (trimmed.match(/\d/g) || []).length;
  return digitCount >= 6 && digitCount <= 15;
}

// party_time is the start time, stored as 24-hour "HH:MM" (what <input type="time"> emits).
function isValidPartyTime(val) {
  return typeof val === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(val.trim());
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

// "14:00" -> "2pm" / "14:30" -> "2:30pm". Returns '' for empty/invalid input.
function fmtPartyTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const ampm = h >= 12 ? 'pm' : 'am';
  let hh = h % 12; if (hh === 0) hh = 12;
  return m ? `${hh}:${String(m).padStart(2, '0')}${ampm}` : `${hh}${ampm}`;
}
// "2pm–3:30pm" from a start time + duration in minutes (start only if no duration).
function fmtTimeRange(start, durMin) {
  if (!start) return '';
  const s = fmtPartyTime(start);
  const [h, m] = String(start).split(':').map(Number);
  if (!durMin || Number.isNaN(h)) return s;
  const tot = Math.min(h * 60 + m + Number(durMin), 23 * 60 + 59);
  const end = `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
  return `${s}–${fmtPartyTime(end)}`;
}

function confirmationEmailHtml({ child_name, confirm_url, dashboard_token, party_date, party_time, party_duration_min }) {
  const timeStr  = fmtTimeRange(party_time, party_duration_min);
  const dateLine = party_date
    ? `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 18px;">🗓️ <strong>${formatPartyDate(party_date)}${timeStr ? ` · ${timeStr}` : ''}</strong></p>`
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
    // Shared Upstash limiter (survives serverless cold starts and is shared
    // across instances — unlike the old per-instance in-memory Map, which
    // effectively didn't limit anything in production).
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (await enforceRateLimit(req, res, {
      name:   'go-live',
      limit:  3,
      window: '1 h',
    })) return;

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
    const party_time     = typeof body.party_time === 'string' ? body.party_time.trim() : null;
    // Party length in minutes. Defaults to 90; clamped to a sane 15min–8h range.
    let party_duration_min = body.party_duration_min !== undefined ? Number(body.party_duration_min) : 90;
    if (!Number.isInteger(party_duration_min) || party_duration_min < 15 || party_duration_min > 480) {
      party_duration_min = 90;
    }
    const count_adults     = body.count_adults === true || body.count_adults === 'true';
    const count_babies     = body.count_babies === true || body.count_babies === 'true';
    const rsvp_cutoff_raw  = body.rsvp_cutoff || null;
    const phone_number     = sanitiseString(body.phone_number, 20);

    if (age !== null && !isValidAge(age)) {
      return res.status(400).json({ error: 'Invalid age — must be between 1 and 120' });
    }
    if (!isValidUrl(photo_url)) {
      return res.status(400).json({ error: 'Invalid photo_url' });
    }
    if (!isValidPhoneNumber(phone_number)) {
      return res.status(400).json({ error: 'Invalid phone_number — please check the format' });
    }
    if (!isValidPartyDate(party_date_raw)) {
      return res.status(400).json({ error: 'Invalid party_date — must be a date within 2 years of today' });
    }
    // party_time is now obligatory — guests need to know when to arrive.
    if (!isValidPartyTime(party_time)) {
      return res.status(400).json({ error: 'Invalid or missing party_time — please provide a start time (HH:MM)' });
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
        party_time,
        party_duration_min,
        count_adults,
        count_babies,
        rsvp_cutoff,
        phone_number,
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
        html:    confirmationEmailHtml({ child_name, confirm_url, dashboard_token, party_date, party_time, party_duration_min }),
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
          🗓️ <strong>Date:</strong> ${formatPartyDate(party_date)}${fmtTimeRange(party_time, party_duration_min) ? ` · ${fmtTimeRange(party_time, party_duration_min)}` : ''}<br/>
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
