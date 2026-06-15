// Updated: 2026-06-13
// api/cron/send-reminders.js
// Runs daily at 08:00 UTC via vercel.json cron.
// Finds parties in exactly 3 days and emails confirmed guests.
// All attending guests now have an email and reminder_optin=true by default,
// so the query naturally catches everyone. The filter is kept for safety
// (legacy records from before the mandatory-email change may have null).

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DAYS_BEFORE = 3;
const BASE_URL    = 'https://tinyinvites.org';
const ADMIN_EMAIL = 'hello@tinyinvites.org';
const FROM_EMAIL  = 'Tiny Invites <hello@tinyinvites.org>';

// ── Helpers ───────────────────────────────────────────────

// Returns the UK calendar date (Europe/London) that is `n` days from now.
// Using Europe/London (rather than raw UTC) ensures the date matches the
// calendar day hosts picked when creating their party, even across the
// BST/GMT clock change.
function dateInDays(n) {
  const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return dateStr; }
}

// "14:00" -> "2pm" / "14:30" -> "2:30pm". Returns '' for empty/invalid input.
function formatTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const ampm = h >= 12 ? 'pm' : 'am';
  let hh = h % 12; if (hh === 0) hh = 12;
  return m ? `${hh}:${String(m).padStart(2, '0')}${ampm}` : `${hh}${ampm}`;
}

function mapsUrl(venue) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
}

function ordSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function unsubscribeUrl(guestId) {
  return `${BASE_URL}/api/unsubscribe-reminder?id=${guestId}`;
}

// Escape guest-/host-supplied text before placing it in email HTML.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Retry helper ──────────────────────────────────────────

async function withRetry(fn, delayMs = 2000) {
  try {
    return await fn();
  } catch (firstErr) {
    console.warn('  ↻ Retrying after error:', firstErr.message);
    await new Promise(r => setTimeout(r, delayMs));
    return await fn();
  }
}

// ── Host note block ───────────────────────────────────────

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
                      white-space:pre-line;">${esc(note)}</p>
          </td></tr>
        </table>
      </td>
    </tr>`;
}

// ── Reminder email template ───────────────────────────────

function buildReminderHtml({ party, guest, note, hostCopy = false }) {
  const childName = party.child_name || 'the birthday child';
  const venue     = party.venue || '';
  const partyDate = party.party_date ? formatDate(party.party_date) : 'soon';
  const partyTime = formatTime(party.party_time);
  const age       = party.age || '';
  const guestName = guest.guest_name || 'there';
  const ageLine   = age
    ? `${esc(childName)}'s ${esc(age)}${ordSuffix(Number(age))} birthday party`
    : `${esc(childName)}'s birthday party`;
  const unsubLink = unsubscribeUrl(guest.id);

  // Host copy: a banner at the top + a host-appropriate footer (no unsubscribe).
  const hostBanner = hostCopy ? `
        <tr><td style="padding:20px 40px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef4ef;border:1px solid #cfe0d4;border-radius:12px;">
            <tr><td style="padding:14px 18px;font-size:13px;color:#3f6b50;line-height:1.6;">
              📋 <strong>Your host copy.</strong> This is the reminder your confirmed guests received today, so you know exactly what landed in their inbox.
            </td></tr>
          </table>
        </td></tr>` : '';

  const footer = hostCopy ? `
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f5edda;text-align:center;">
            <p style="margin:0;font-size:11px;color:#a89880;">
              RSVPs made beautiful by
              <a href="${BASE_URL}" style="color:#c9a84c;text-decoration:none;">Tiny Invites</a> ✨
            </p>
            <p style="margin:8px 0 0;font-size:10px;color:#c8bba8;">You're receiving this as the host of this party.</p>
          </td>
        </tr>` : `
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f5edda;text-align:center;">
            <p style="margin:0;font-size:11px;color:#a89880;">
              RSVPs made beautiful by
              <a href="${BASE_URL}" style="color:#c9a84c;text-decoration:none;">Tiny Invites</a> ✨
            </p>
            <p style="margin:8px 0 0;font-size:10px;color:#c8bba8;">
              You received this because you RSVPd yes to this party.<br/>
              <a href="${unsubLink}" style="color:#c8bba8;text-decoration:underline;">Unsubscribe from reminders</a>
            </p>
          </td>
        </tr>`;

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
            <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:400;color:#fff;">
              🎈 See you in <strong style="color:#e8d5a3;">3 days!</strong>
            </h1>
          </td>
        </tr>
        ${hostBanner}

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 24px;">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;">Hi <strong>${esc(guestName)}</strong>,</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;">
              Just a reminder that <strong>${ageLine}</strong> is in <strong>3 days</strong>! 🎂
            </p>

            <!-- Party details -->
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#f5edda;border:1px solid #e8d5a3;border-radius:14px;margin-bottom:24px;">
              <tr><td style="padding:20px 24px;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0;font-size:13px;width:28px;">🗓️</td>
                    <td style="padding:6px 0;font-size:13px;">${partyDate}</td>
                  </tr>
                  ${partyTime ? `<tr>
                    <td style="padding:6px 0;font-size:13px;width:28px;">🕐</td>
                    <td style="padding:6px 0;font-size:13px;">${partyTime}</td>
                  </tr>` : ''}
                  ${venue ? `<tr>
                    <td style="padding:6px 0;font-size:13px;width:28px;">📍</td>
                    <td style="padding:6px 0;font-size:13px;">
                      <a href="${mapsUrl(venue)}" style="color:#c9a84c;">${esc(venue)} ↗</a>
                    </td>
                  </tr>` : ''}
                  ${party.parent_email ? `<tr>
                    <td style="padding:6px 0;font-size:13px;width:28px;">✉️</td>
                    <td style="padding:6px 0;font-size:13px;">
                      <a href="mailto:${esc(party.parent_email)}" style="color:#c9a84c;">${esc(party.parent_email)}</a>
                    </td>
                  </tr>` : ''}
                </table>
              </td></tr>
            </table>

            <p style="margin:0;font-size:15px;line-height:1.7;">See you there for cake and celebrations! 🎉</p>
          </td>
        </tr>

        <!-- Host note (conditional) -->
        ${hostNoteBlock(note)}

        <!-- Footer -->
        ${footer}

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────

export default async function handler(req, res) {

  // If CRON_SECRET is unset, `Bearer undefined` would match a literal
  // "Bearer undefined" header — fail closed instead.
  if (!process.env.CRON_SECRET
      || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const targetDate = dateInDays(DAYS_BEFORE);

    // Debug logging — lets us confirm the cron fired, what UK/UTC time it
    // ran at, and exactly which date string it searched for. Compare
    // targetDate against the party_date stored in Supabase if a reminder
    // appears to be missing.
    console.log('[send-reminders] debug', {
      nowUTC: new Date().toISOString(),
      nowLondon: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }),
      targetDate,
    });
    console.log(`[send-reminders] Looking for parties on ${targetDate}`);

    const { data: parties, error: partiesError } = await supabase
      .from('parties')
      .select('*')
      .eq('party_date', targetDate)
      .eq('confirmed', true);

    if (partiesError) throw partiesError;

    if (!parties || parties.length === 0) {
      console.log('[send-reminders] No confirmed parties in 3 days.');

      // Send an admin email even on zero matches, so a "silent" run is
      // visibly distinguishable from a cron that never fired / failed auth.
      try {
        await resend.emails.send({
          from:    FROM_EMAIL,
          to:      ADMIN_EMAIL,
          subject: `⏰ send-reminders ran — 0 parties found for ${targetDate}`,
          html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#2a2218;line-height:1.8;">
            <strong>Daily reminder cron completed</strong><br/><br/>
            🎯 <strong>Target date searched:</strong> ${targetDate}<br/>
            🕓 <strong>Ran at (UTC):</strong> ${new Date().toUTCString()}<br/>
            🕓 <strong>Ran at (London):</strong> ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}<br/>
            ℹ️ No confirmed parties matched this date.
          </p>`,
        });
      } catch (adminErr) {
        console.error('Admin "no parties" email failed:', adminErr.message);
      }

      return res.status(200).json({ message: 'No parties in 3 days.', targetDate });
    }

    let sent = 0, skipped = 0;
    const failures = [];

    for (const party of parties) {
      // attending is stored as 'yes'/'no' (string) in this schema.
      // reminder_optin filter retained for safety — legacy guests before the
      // mandatory-email change may have it false or null.
      const { data: guests, error: guestsError } = await supabase
        .from('guest_responses')
        .select('*')
        .eq('party_id', party.party_id)
        .in('attending', ['yes', 'true'])   // legacy rows stored 'true'
        .eq('reminder_optin', true)
        .not('guest_email', 'is', null)
        .neq('guest_email', '');

      if (guestsError) throw guestsError;

      const note = (party.reminder_note || '').trim();
      console.log(`[send-reminders] "${party.child_name}" — ${guests.length} guest(s) to remind${note ? ' (host note included)' : ''}`);

      for (const guest of guests) {
        try {
          await withRetry(() => resend.emails.send({
            from:    FROM_EMAIL,
            to:      guest.guest_email,
            subject: `🎉 Just 3 days to go — ${party.child_name}'s party is almost here!`,
            html:    buildReminderHtml({ party, guest, note }),
            headers: {
              'List-Unsubscribe':      `<${unsubscribeUrl(guest.id)}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }));
          console.log(`  ✓ ${guest.guest_email}`);
          sent++;
        } catch (err) {
          console.error(`  ✗ ${guest.guest_email} (gave up after retry):`, err.message);
          failures.push({ email: guest.guest_email, name: guest.guest_name, error: err.message });
          skipped++;
        }
      }

      // ── Host copy ─────────────────────────────────────────
      // Send the host the same reminder their guests received, so they have a
      // record of it. Only when there were guests to remind. Best-effort: a
      // failed host copy must not affect the guest sends or the cron result.
      if (party.parent_email && guests.length > 0) {
        try {
          await withRetry(() => resend.emails.send({
            from:    FROM_EMAIL,
            to:      party.parent_email,
            subject: `📋 Host copy — the 3-day reminder for ${party.child_name}'s party just went out`,
            html:    buildReminderHtml({
              party,
              guest: { guest_name: 'there', id: 'host' },
              note,
              hostCopy: true,
            }),
          }));
          console.log(`  ✓ host copy → ${party.parent_email}`);
        } catch (err) {
          console.error(`  ✗ host copy → ${party.parent_email}:`, err.message);
        }
      }
    }

    // ── Admin summary ─────────────────────────────────────
    const failureRows = failures.length
      ? `<br/><strong>Failed addresses:</strong><br/>` +
        failures.map(f => `• ${esc(f.name)} &lt;${esc(f.email)}&gt; — ${esc(f.error)}`).join('<br/>')
      : '';

    const partiesWithNotes = parties.filter(p => !!p.reminder_note).length;

    try {
      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      ADMIN_EMAIL,
        subject: `⏰ send-reminders ran — ${sent} sent, ${skipped} failed`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#2a2218;line-height:1.8;">
          <strong>Daily reminder cron completed</strong><br/><br/>
          ✅ <strong>Sent:</strong> ${sent}<br/>
          ❌ <strong>Failed (after retry):</strong> ${skipped}<br/>
          🗓️ <strong>Target party date:</strong> ${targetDate}<br/>
          🎉 <strong>Parties processed:</strong> ${parties.length}<br/>
          📝 <strong>Parties with host note:</strong> ${partiesWithNotes}<br/>
          🕓 <strong>Ran at:</strong> ${new Date().toUTCString()}
          ${failureRows}
        </p>`,
      });
    } catch (adminErr) {
      console.error('Admin summary email failed:', adminErr.message);
    }

    return res.status(200).json({
      sent,
      skipped,
      parties: parties.length,
      noteIncluded: partiesWithNotes > 0,
    });

  } catch (err) {
    console.error('[send-reminders] Fatal:', err);
    return res.status(500).json({ error: err.message });
  }
}
