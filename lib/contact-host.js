// Updated: 2026-06-05
// lib/contact-host.js
//
// Lets a guest send a free-text message to the party host without
// the host's email address ever being exposed to the browser.
//
// Route: POST /api/rsvp?action=contact-host
//
// Body: { party_id, guest_name, guest_email (optional), message }

import { createClient } from '@supabase/supabase-js';
import { Resend }       from 'resend';
import { hostFooter }   from './send-email.js';
import { enforceRateLimit } from './rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

function sanitiseString(val, maxLen = 200) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function isValidEmail(str) {
  return typeof str === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
}

const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

// Escape guest-/host-supplied text before placing it in email HTML.
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

const btnHtml = (href, text) =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td align="center">
    <a href="${href}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">${text}</a>
  </td></tr></table>`;

function contactHtml({ party, guestName, guestEmail, message }) {
  const dashUrl  = `https://tinyinvites.org/dashboard_page.html?token=${party.dashboard_token}`;
  const ageStr   = party.age ? `${ordinal(party.age)} birthday` : 'party';
  const replyRow = guestEmail
    ? `<p style="font-size:0.82rem;color:#6b5c45;margin:0 0 16px;">Reply directly to: <a href="mailto:${encodeURIComponent(guestEmail)}" style="color:#c9a84c;">${esc(guestEmail)}</a></p>`
    : '';

  const inner = `
    <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">Message from a guest ✉️</p>
    <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 16px;line-height:1.3;">${esc(guestName)} sent you a message</h1>
    <p style="font-size:0.85rem;color:#6b5c45;line-height:1.6;margin:0 0 12px;">Regarding ${esc(party.child_name)}'s ${ageStr}:</p>
    <p style="font-size:0.9rem;color:#2a2218;background:#fff3e0;border-left:3px solid #c9a84c;padding:14px 16px;border-radius:0 6px 6px 0;margin:0 0 16px;font-style:italic;">"${esc(message)}"</p>
    ${replyRow}
    ${btnHtml(dashUrl, '📊 See full guest list →')}
  `;

  const heroBlock = party.photo_url ? `
    <tr><td style="padding:0;overflow:hidden;">
      <img src="${party.photo_url}" alt="Party" style="width:100%;max-height:200px;object-fit:cover;display:block;border-radius:12px 12px 0 0;">
    </td></tr>` : '';

  const footerBlock = party.dashboard_token ? hostFooter(party.dashboard_token) : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:16px;"><span style="font-family:Georgia,serif;font-size:1.2rem;font-style:italic;color:#c9a84c;">Tiny Invites</span></td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:14px;overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${heroBlock}
      <tr><td style="padding:32px 40px 36px;">${inner}</td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;padding:20px 0 0;"><p style="font-size:0.68rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span> · <a href="https://tinyinvites.org" style="color:#a89880;text-decoration:none;">tinyinvites.org</a></p></td></tr>
  ${footerBlock}
</table>
</td></tr></table></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit: max 5 contact messages per IP per hour
  if (await enforceRateLimit(req, res, {
    name:   'contact-host:ip',
    limit:  5,
    window: '60 m',
  })) return;

  try {
    const body       = req.body || {};
    const party_id   = sanitiseString(body.party_id, 36);
    const guest_name = sanitiseString(body.guest_name, 100);
    const message    = sanitiseString(body.message, 1000);
    const guest_email = body.guest_email
      ? body.guest_email.toString().trim().toLowerCase()
      : null;

    if (!party_id)   return res.status(400).json({ error: 'Missing party_id' });
    if (!guest_name) return res.status(400).json({ error: 'Missing guest_name' });
    if (!message)    return res.status(400).json({ error: 'Missing message' });
    if (!/^[0-9a-f-]{36}$/.test(party_id))
      return res.status(400).json({ error: 'Invalid party_id format' });
    if (guest_email && !isValidEmail(guest_email))
      return res.status(400).json({ error: 'Invalid guest email' });

    // ── Look up party (has access to parent_email via service role) ──
    const { data: party, error: partyError } = await supabase
      .from('parties')
      .select('*')
      .eq('party_id', party_id)
      .single();

    if (partyError || !party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    if (!party.parent_email) {
      return res.status(422).json({ error: 'No host email on record' });
    }

    // ── Send relay email to host ──────────────────────────────
    await resend.emails.send({
      from:    'Tiny Invites <hello@tinyinvites.org>',
      to:      party.parent_email,
      // If guest provided their email, allow host to reply directly
      ...(guest_email ? { reply_to: guest_email } : {}),
      subject: `✉️ Message from ${guest_name} — ${party.child_name}'s party`,
      html:    contactHtml({ party, guestName: guest_name, guestEmail: guest_email, message }),
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('contact-host error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
