// Updated: 2026-05-21
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';
import { hostFooter } from './send-email.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

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
  try { new URL(val); return true; } catch { return false; }
}

// party_date is optional, but if provided must be a parseable date in the
// reasonable future or recent past (within 2 years on either side, to catch
// obviously wrong years like 1995 from a typo).
function isValidPartyDate(val) {
  if (val === null || val === undefined || val === '') return true;
  if (typeof val !== 'string') return false;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return false;
  const now  = Date.now();
  const TWO_YEARS = 1000 * 60 * 60 * 24 * 365 * 2;
  return d.getTime() > now - TWO_YEARS && d.getTime() < now + TWO_YEARS;
}

// Normalise to a YYYY-MM-DD string the DB can store as a date column.
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
          You're one step away from publishing <strong>${child_name}'s</strong> party page.
          Click the button below to confirm your email address and make your RSVP page live.
        </p>
        ${dateLine}
        <p style="font-size:0.82rem;color:#a89880;margin:0 0 24px;">
          This link expires in <strong>24 hours</strong>. If you didn't create this party, you can safely ignore this email.
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

    const age          = body.age !== undefined ? Number(body.age) : null;
    const venue        = sanitiseString(body.venue, 200);
    const special_note = sanitiseString(body.special_note, 500);
    const phone_number = sanitiseString(body.phone_number, 30);
    const photo_url    = sanitiseString(body.photo_url, 500);
    const party_date_raw = body.party_date !== undefined ? body.party_date : null;

    // Guest-counting preferences. Defaults: children are always counted,
    // adults and babies only if the host explicitly enabled them.
    const count_adults = body.count_adults === true || body.count_adults === 'true';
    const count_babies = body.count_babies === true || body.count_babies === 'true';

    if (age !== null && !isValidAge(age)) {
      return res.status(400).json({ error: 'Invalid age — must be between 1 and 120' });
    }
    if (!isValidUrl(photo_url)) {
      return res.status(400).json({ error: 'Invalid photo_url' });
    }
    if (!isValidPartyDate(party_date_raw)) {
      return res.status(400).json({ error: 'Invalid party_date — must be a date within 2 years of today' });
    }
    const party_date = normalisePartyDate(party_date_raw);

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
        phone_number,
        party_date,
        count_adults,
        count_babies,
        confirmed: false,
      }]);

    if (dbError) {
      console.error('DB insert error:', dbError.message);
      return res.status(500).json({ error: 'Failed to save party' });
    }

    // ── Send confirmation email ───────────────────────────
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
      // Don't block — party is saved, they can request resend later
    }

    return res.status(200).json({
      success: true,
      party_id,
      // No dashboard_token in response yet — sent only after confirmation
      message: 'Check your email to confirm and go live',
    });

  } catch (err) {
    console.error('go-live error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
