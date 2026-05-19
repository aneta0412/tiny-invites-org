// go-live.js
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

// ── Validation helpers ─────────────────────────────────────────
function isValidEmail(str) {
  return typeof str === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
}

function sanitiseString(val, maxLen = 200) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function isValidAge(val) {
  if (val === null || val === undefined) return true; // optional
  const n = Number(val);
  return Number.isInteger(n) && n >= 1 && n <= 18;
}

function isValidUrl(val) {
  if (!val) return true; // optional
  try { new URL(val); return true; } catch { return false; }
}

// ── Email template ─────────────────────────────────────────────
function welcomeEmailHtml({ child_name, age, venue, dashboard_token, party_id, photo_url }) {
  const dashUrl  = `https://tinyinvites.org/dashboard_page.html?token=${dashboard_token}`;
  const rsvpUrl  = `https://tinyinvites.org/rsvp.html?party=${party_id}`;
  const ageStr   = age ? `${ordinal(age)} birthday` : 'party';
  const heroBlock = photo_url
    ? `<tr><td style="padding:0;overflow:hidden;"><img src="${photo_url}" alt="Party" style="width:100%;max-height:200px;object-fit:cover;display:block;border-radius:12px 12px 0 0;"></td></tr>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:16px;"><span style="font-family:Georgia,serif;font-size:1.2rem;font-style:italic;color:#c9a84c;">Tiny Invites</span></td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:14px;overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${heroBlock}
      <tr><td style="padding:32px 40px 36px;">
        <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">Your party is live ✦</p>
        <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.3;">${child_name}'s ${ageStr} is all set! 🎉</h1>
        <p style="font-size:0.87rem;color:#6b5c45;line-height:1.7;margin:0 0 18px;">
          Your RSVP page is live. Share the link or QR code and you will get an email each time a guest responds.
          ${venue ? `<br><br>📍 <strong style="color:#2a2218;">${venue}</strong>` : ''}
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td align="center">
          <a href="${dashUrl}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">View your dashboard</a>
        </td></tr></table>
        <p style="font-size:0.75rem;color:#a89880;margin:18px 0 0;text-align:center;">
          <a href="${rsvpUrl}" style="color:#a89880;text-decoration:underline;">Preview RSVP page</a>
          &nbsp;·&nbsp; Save this email — your dashboard link is unique to you.
        </p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;padding:20px 0 0;">
    <p style="font-size:0.68rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span></p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

// ── Handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};

    // ── Required fields ──────────────────────────────────────
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

    // ── Optional fields ──────────────────────────────────────
    const age          = body.age !== undefined ? Number(body.age) : null;
    const venue        = sanitiseString(body.venue, 200);
    const special_note = sanitiseString(body.special_note, 500);
    const phone_number = sanitiseString(body.phone_number, 30);
    const photo_url    = sanitiseString(body.photo_url, 500);

    if (age !== null && !isValidAge(age)) {
      return res.status(400).json({ error: 'Invalid age — must be between 1 and 18' });
    }
    if (!isValidUrl(photo_url)) {
      return res.status(400).json({ error: 'Invalid photo_url' });
    }

    // ── Generate IDs ─────────────────────────────────────────
    const party_id        = randomUUID();
    const dashboard_token = randomUUID();

    // ── DB insert ────────────────────────────────────────────
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
      }]);

    if (dbError) {
      console.error('DB insert error:', dbError.message);
      return res.status(500).json({ error: 'Failed to save party' }); // don't leak db message
    }

    // ── Send email (non-fatal) ───────────────────────────────
    let emailId    = null;
    let emailError = null;
    try {
      const emailResult = await resend.emails.send({
        from:    'Tiny Invites <hello@tinyinvites.org>',
        to:      parent_email,
        subject: `Your RSVP page for ${child_name}'s party is live!`,
        html:    welcomeEmailHtml({ child_name, age, venue, dashboard_token, party_id, photo_url: photo_url || '' }),
      });
      emailId = emailResult?.id || null;
    } catch (err) {
      console.error('Email send error:', err.message);
      emailError = 'Email could not be sent'; // don't leak resend internals
    }

    return res.status(200).json({
      success:        true,
      party_id,
      dashboard_token,
      rsvp_link:      `/rsvp.html?party=${party_id}`,
      dashboard_link: `/dashboard_page.html?token=${dashboard_token}`,
      email_sent:     !!emailId,
      email_id:       emailId,
      email_error:    emailError,
    });

  } catch (err) {
    console.error('go-live error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
