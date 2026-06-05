// Updated: 2026-06-05
// lib/resend-confirmation.js
//
// Resends (or re-addresses) the go-live confirmation email without
// creating a duplicate party. Called from rsvp-host.html when the host
// clicks "Resend" or corrects a typo in their email address.
//
// Route: POST /api/party?action=resend-confirmation
//
// Body:
//   parent_email  — the email used when the party was created (lookup key)
//   party_date    — the party date used at creation (lookup key)
//   new_email     — (optional) corrected address; if provided, updates the
//                   party record before resending

import { createClient } from '@supabase/supabase-js';
import { Resend }       from 'resend';
import { esc, formatPartyDate, hostFooter } from './send-email.js';
import { enforceRateLimit } from './rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function confirmationEmailHtml({ child_name, confirm_url, party_date }) {
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
        <p style="font-size:0.78rem;color:#a89880;text-align:center;margin:16px 0 0;">
          Or copy this link: <a href="${confirm_url}" style="color:#a89880;">${confirm_url}</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;padding:20px 0 0;">
    <p style="font-size:0.68rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span> · <a href="https://tinyinvites.org" style="color:#a89880;text-decoration:none;">tinyinvites.org</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit: 5 resends per IP per 10 minutes
  if (await enforceRateLimit(req, res, {
    name:   'resend-confirmation:ip',
    limit:  5,
    window: '10 m',
  })) return;

  const body         = req.body || {};
  const parent_email = (body.parent_email || '').trim().toLowerCase();
  const party_date   = (body.party_date   || '').trim();
  const new_email    = body.new_email ? body.new_email.trim().toLowerCase() : null;

  if (!isValidEmail(parent_email))
    return res.status(400).json({ error: 'Invalid email' });
  if (!party_date)
    return res.status(400).json({ error: 'Missing party_date' });
  if (new_email && !isValidEmail(new_email))
    return res.status(400).json({ error: 'Invalid new_email' });

  // Look up the party by email + date
  const { data: party, error: partyError } = await supabase
    .from('parties')
    .select('*')
    .eq('parent_email', parent_email)
    .eq('party_date', party_date)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (partyError || !party) {
    return res.status(404).json({ error: 'Party not found — check the email address and date.' });
  }

  if (party.confirmed) {
    return res.status(409).json({ error: 'This party is already confirmed and live.' });
  }

  // Update email if a correction was provided
  const sendTo = new_email || parent_email;
  if (new_email && new_email !== parent_email) {
    const { error: updateError } = await supabase
      .from('parties')
      .update({ parent_email: new_email })
      .eq('party_id', party.party_id);

    if (updateError) {
      console.error('[resend-confirmation] update error:', updateError.message);
      return res.status(500).json({ error: 'Failed to update email address' });
    }
  }

  // Resend the confirmation email
  const confirm_url = `https://tinyinvites.org/confirm.html?token=${party.dashboard_token}`;

  try {
    await resend.emails.send({
      from:    'Tiny Invites <hello@tinyinvites.org>',
      to:      sendTo,
      subject: `Confirm your party page for ${party.child_name} — resent`,
      html:    confirmationEmailHtml({
        child_name:  party.child_name,
        confirm_url,
        party_date:  party.party_date,
      }),
    });
  } catch (err) {
    console.error('[resend-confirmation] email error:', err.message);
    return res.status(500).json({ error: 'Failed to send email' });
  }

  return res.status(200).json({ success: true, sent_to: sendTo });
}
