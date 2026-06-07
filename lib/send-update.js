// lib/send-update.js
// Sends a host-authored update to all attending guests of a party.
// Called by dashboard-api?action=send-update (proxies the browser request
// server-side so CRON_SECRET never touches the client).
// POST body: { token, message, subject?, note? }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE_URL    = 'https://tinyinvites.org';
const FROM_EMAIL  = 'Tiny Invites <hello@tinyinvites.org>';
const ADMIN_EMAIL = 'hello@tinyinvites.org';

const MAX_MESSAGE = 2000;
const MAX_NOTE    = 500;

// ── Helpers ───────────────────────────────────────────────

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return dateStr; }
}

function unsubscribeUrl(guestId) {
  return `${BASE_URL}/api/unsubscribe-reminder?id=${guestId}`;
}

async function withRetry(fn, delayMs = 2000) {
  try {
    return await fn();
  } catch (err) {
    console.warn('  ↻ Retrying:', err.message);
    await new Promise(r => setTimeout(r, delayMs));
    return await fn();
  }
}

// ── Note block ────────────────────────────────────────────

// ── Email template ────────────────────────────────────────

function buildUpdateHtml({ party, guest, message, note }) {
  const childName = party.child_name || 'the birthday child';
  const partyDate = party.party_date ? formatDate(party.party_date) : 'soon';
  const guestName = guest.guest_name || 'there';
  const unsubLink = unsubscribeUrl(guest.id);
  const heroBlock = party.photo_url ? `
    <tr><td style="padding:0;overflow:hidden;">
      <img src="${party.photo_url}" alt="Party" style="width:100%;max-height:200px;object-fit:cover;display:block;border-radius:12px 12px 0 0;">
    </td></tr>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:16px;">
    <span style="font-family:Georgia,serif;font-size:1.2rem;font-style:italic;color:#c9a84c;">Tiny Invites</span>
  </td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:14px;overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${heroBlock}
      <tr><td style="padding:32px 40px 36px;">
        <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">A message from the host 📢</p>
        <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 16px;line-height:1.3;">Update about ${escapeHtml(childName)}'s party</h1>
        <p style="font-size:0.85rem;color:#6b5c45;margin:0 0 6px;">Hi <strong>${escapeHtml(guestName)}</strong>,</p>
        <p style="font-size:0.9rem;color:#2a2218;line-height:1.8;margin:0 0 16px;white-space:pre-line;">${escapeHtml(message)}</p>
        ${note ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;"><tr><td style="background:#fff3e0;border-left:3px solid #c9a84c;padding:14px 16px;border-radius:0 6px 6px 0;">
          <p style="font-size:0.68rem;letter-spacing:0.12em;text-transform:uppercase;color:#8a6d00;margin:0 0 6px;">Note from the host</p>
          <p style="font-size:0.88rem;color:#2a2218;line-height:1.7;margin:0;white-space:pre-line;">${escapeHtml(note)}</p>
        </td></tr></table>` : ''}
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;padding:20px 0 0;">
    <p style="font-size:0.68rem;color:#a89880;margin:0;">
      Sent by <span style="color:#c9a84c;">Tiny Invites</span> ·
      <a href="${BASE_URL}" style="color:#a89880;text-decoration:none;">tinyinvites.org</a>
    </p>
    <p style="font-size:0.65rem;color:#c8bba8;margin:6px 0 0;">
      You RSVPd to ${escapeHtml(childName)}'s party · ${escapeHtml(partyDate)}<br/>
      <a href="${unsubLink}" style="color:#c8bba8;text-decoration:underline;">Unsubscribe from updates</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────

export default async function sendUpdate(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, message, subject, note } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  const cleanMessage = (message || '').trim();
  const cleanSubject = (subject || '').trim();
  const cleanNote    = (note    || '').trim();

  if (!cleanMessage) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (cleanMessage.length > MAX_MESSAGE) {
    return res.status(400).json({ error: `message exceeds ${MAX_MESSAGE} characters` });
  }
  if (cleanNote.length > MAX_NOTE) {
    return res.status(400).json({ error: `note exceeds ${MAX_NOTE} characters` });
  }

  // Resolve token → party
  const { data: party, error: partyError } = await supabase
    .from('parties')
    .select('*')
    .eq('dashboard_token', token)
    .eq('confirmed', true)
    .single();

  if (partyError || !party) {
    return res.status(403).json({ error: 'Invalid token or party not confirmed' });
  }

 // Fetch attending guests with emails — excluding unsubscribed guests
  const { data: guests, error: guestsError } = await supabase
    .from('guest_responses')
    .select('*')
    .eq('party_id', party.party_id)
    .eq('attending', 'yes')
    .not('guest_email', 'is', null)
    .neq('guest_email', '')
    .neq('reminder_optin', false);   // ← ADD THIS LINE
  if (guestsError) {
    console.error('[send-update] guests query:', guestsError.message);
    return res.status(500).json({ error: 'Failed to load guests' });
  }

  if (!guests || guests.length === 0) {
    return res.status(200).json({ sent: 0, skipped: 0, message: 'No guests to notify' });
  }

  const emailSubject = cleanSubject || `📢 Update about ${party.child_name || 'the'} party`;

  let sent = 0, skipped = 0;
  const failures = [];

  for (const guest of guests) {
    try {
      await withRetry(() => resend.emails.send({
        from:    FROM_EMAIL,
        to:      guest.guest_email,
        subject: emailSubject,
        html:    buildUpdateHtml({ party, guest, message: cleanMessage, note: cleanNote }),
        headers: {
          'List-Unsubscribe':      `<${unsubscribeUrl(guest.id)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }));
      console.log(`  ✓ ${guest.guest_email}`);
      sent++;
    } catch (err) {
      console.error(`  ✗ ${guest.guest_email}:`, err.message);
      failures.push({ email: guest.guest_email, name: guest.guest_name, error: err.message });
      skipped++;
    }
  }

  // Admin summary
  try {
    const failureRows = failures.length
      ? `<br/><strong>Failed:</strong><br/>` +
        failures.map(f => `• ${f.name} &lt;${f.email}&gt; — ${f.error}`).join('<br/>')
      : '';
    await resend.emails.send({
      from:    FROM_EMAIL,
      to:      ADMIN_EMAIL,
      subject: `📢 send-update — "${party.child_name}" — ${sent} sent, ${skipped} failed`,
      html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#2a2218;line-height:1.8;">
        <strong>Host-triggered party update</strong><br/><br/>
        🎂 <strong>Party:</strong> ${escapeHtml(party.child_name || party.party_id)}<br/>
        ✅ <strong>Sent:</strong> ${sent}<br/>
        ❌ <strong>Failed:</strong> ${skipped}<br/>
        📝 <strong>Note included:</strong> ${cleanNote ? 'Yes' : 'No'}<br/>
        💬 <strong>Message:</strong> ${escapeHtml(cleanMessage.slice(0, 120))}${cleanMessage.length > 120 ? '…' : ''}<br/>
        🕓 <strong>Ran at:</strong> ${new Date().toUTCString()}
        ${failureRows}
      </p>`,
    });
  } catch (adminErr) {
    console.error('[send-update] admin summary failed:', adminErr.message);
  }

  return res.status(200).json({ sent, skipped, noteIncluded: !!cleanNote });
}
