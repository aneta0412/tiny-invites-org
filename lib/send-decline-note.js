// Updated: 2026-06-02
// lib/send-decline-note.js
//
// Called by rsvp.html after a guest declines — either because they typed a
// note and hit Send, or because the 30-second no-note timer fired.
//
// What it does:
//   1. If a note is present, updates the guest_responses row (allergies col)
//   2. Looks up the party and today's RSVP count
//   3. Sends the host notification email (with or without note)
//
// Route: POST /api/rsvp?action=send-decline-note

import { createClient } from '@supabase/supabase-js';
import { Resend }       from 'resend';
import { hostFooter }   from './send-email.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const INDIVIDUAL_NOTIFICATION_LIMIT = 15;

function sanitiseString(val, maxLen = 200) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

const btnHtml = (href, text) =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td align="center">
    <a href="${href}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">${text}</a>
  </td></tr></table>`;

const base = (inner, photoUrl = '', deleteToken = null) => {
  const heroBlock = photoUrl ? `
    <tr><td style="padding:0;overflow:hidden;">
      <img src="${photoUrl}" alt="Party" style="width:100%;max-height:200px;object-fit:cover;display:block;border-radius:12px 12px 0 0;">
    </td></tr>` : '';
  const footerBlock = deleteToken ? hostFooter(deleteToken) : '';
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
};

function declineNotificationHtml({ party, guestName, note, todayCount }) {
  const dashUrl  = `https://tinyinvites.org/dashboard_page.html?token=${party.dashboard_token}`;
  const ageStr   = party.age ? `${ordinal(party.age)} birthday` : 'party';
  const noteBlock = note
    ? `<p style="font-size:0.85rem;color:#6b5c45;background:#fff3e0;border-left:3px solid #c9a84c;padding:10px 14px;border-radius:0 6px 6px 0;margin:0 0 12px;">💬 Message from guest: <strong>${note}</strong></p>`
    : '';
  const nearLimit = todayCount >= INDIVIDUAL_NOTIFICATION_LIMIT - 2;
  const atLimit   = todayCount >= INDIVIDUAL_NOTIFICATION_LIMIT;
  const digestNote = atLimit
    ? `<p style="font-size:0.78rem;color:#a89880;margin:12px 0 0;">You've received ${INDIVIDUAL_NOTIFICATION_LIMIT} individual notifications today — further replies today will arrive in your 8pm digest.</p>`
    : nearLimit
    ? `<p style="font-size:0.78rem;color:#a89880;margin:12px 0 0;">${INDIVIDUAL_NOTIFICATION_LIMIT - todayCount} more individual notification${INDIVIDUAL_NOTIFICATION_LIMIT - todayCount === 1 ? '' : 's'} today — after that, replies will be bundled into your 8pm digest.</p>`
    : '';

  return base(`
    <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">New RSVP 🥺</p>
    <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 16px;line-height:1.3;">${guestName} can't make it to ${party.child_name}'s ${ageStr}</h1>
    ${noteBlock}
    ${digestNote}
    ${btnHtml(dashUrl, '📊 See full guest list →')}
  `, party.photo_url || '', party.dashboard_token);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body       = req.body || {};
    const party_id   = sanitiseString(body.party_id, 36);
    const response_id = body.response_id || null;
    const note       = sanitiseString(body.note, 500);

    if (!party_id) return res.status(400).json({ error: 'Missing party_id' });

    // ── 1. Look up party ──────────────────────────────────────
    const { data: party, error: partyError } = await supabase
      .from('parties')
      .select('*')
      .eq('party_id', party_id)
      .single();

    if (partyError || !party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    // ── 2. Look up guest response ─────────────────────────────
    let guestName = 'A guest';

    if (response_id) {
      const { data: responseRow } = await supabase
        .from('guest_responses')
        .select('guest_name')
        .eq('id', response_id)
        .maybeSingle();

      if (responseRow) guestName = responseRow.guest_name;

      // Update allergies column with note if provided
      if (note) {
        await supabase
          .from('guest_responses')
          .update({ allergies: note })
          .eq('id', response_id);
      }
    }

    // ── 3. Count today's RSVPs for digest threshold ───────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: todayCount } = await supabase
      .from('guest_responses')
      .select('id', { count: 'exact', head: true })
      .eq('party_id', party_id)
      .gte('created_at', todayStart.toISOString());

    // ── 4. Send host notification ─────────────────────────────
    if (todayCount <= INDIVIDUAL_NOTIFICATION_LIMIT) {
      await resend.emails.send({
        from:    'Tiny Invites <hello@tinyinvites.org>',
        to:      party.parent_email,
        subject: `${guestName} can't make it to ${party.child_name}'s party`,
        html:    declineNotificationHtml({ party, guestName, note, todayCount }),
      });
    }
    // If over limit, the daily digest will pick it up at 8pm

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('send-decline-note error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
