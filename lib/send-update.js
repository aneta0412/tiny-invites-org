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

function hostNoteBlock(note) {
  if (!note) return '';
  return `
    <tr>
      <td style="padding:0 40px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#fff3cd;border:1px solid #f0d080;border-radius:14px;">
          <tr><td style="padding:18px 22px;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.12em;
                      text-transform:uppercase;color:#8a6d00;">Note from the host</p>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#2a2218;
                      white-space:pre-line;">${escapeHtml(note)}</p>
          </td></tr>
        </table>
      </td>
    </tr>`;
}

// ── Email template ────────────────────────────────────────

function buildUpdateHtml({ party, guest, message, note }) {
  const childName = party.child_name || 'the birthday child';
  const partyDate = party.party_date ? formatDate(party.party_date) : 'soon';
  const guestName = guest.guest_name || 'there';
  const unsubLink = unsubscribeUrl(guest.id);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Helvetica,Arial,sans-serif;color:#2a2218;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#fff9f2;border:1px solid #f5edda;border-radius:20px;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2a2218 0%,#6b5c45 100%);padding:36px 40px;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;
                      color:rgba(250,246,239,0.6);">Tiny Invites</p>
            <h1 style="margin:0;font-family:Georgia,serif;font-size:26px;font-weight:400;color:#fff;">
              📢 Update about the party
            </h1>
            <p style="margin:10px 0 0;font-size:13px;color:rgba(250,246,239,0.75);">
              ${escapeHtml(childName)}'s party · ${escapeHtml(partyDate)}
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 24px;">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;">
              Hi <strong>${escapeHtml(guestName)}</strong>,
            </p>
            <p style="margin:0;font-size:15px;line-height:1.8;white-space:pre-line;">
              ${escapeHtml(message)}
            </p>
          </td>
        </tr>

        <!-- Host note (conditional) -->
        ${hostNoteBlock(note)}

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f5edda;text-align:center;">
            <p style="margin:0;font-size:11px;color:#a89880;">
              RSVPs made beautiful by
              <a href="${BASE_URL}" style="color:#c9a84c;text-decoration:none;">Tiny Invites</a> ✨
            </p>
            <p style="margin:8px 0 0;font-size:10px;color:#c8bba8;">
              You're receiving this update because you RSVPd to ${escapeHtml(childName)}'s party.<br/>
              <a href="${unsubLink}" style="color:#c8bba8;text-decoration:underline;">Unsubscribe from reminders</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
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

  // Fetch attending guests with emails
  const { data: guests, error: guestsError } = await supabase
    .from('guest_responses')
    .select('*')
    .eq('party_id', party.party_id)
    .eq('attending', 'yes')
    .not('guest_email', 'is', null)
    .neq('guest_email', '');

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
