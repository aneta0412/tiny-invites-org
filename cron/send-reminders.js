// Updated: 2026-06-02
// api/cron/send-reminders.js
// Runs daily at 16:00 UTC via vercel.json cron.
// Finds parties in exactly 3 days and emails opted-in confirmed guests.
// Added: unsubscribe links (PECR compliant), 1-retry on failed sends.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DAYS_BEFORE    = 3;
const BASE_URL       = 'https://tinyinvites.org';
const ADMIN_EMAIL    = 'hello@tinyinvites.org';
const FROM_EMAIL     = 'Tiny Invites <hello@tinyinvites.org>';

// ── Helpers ───────────────────────────────────────────────

function dateInDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return dateStr; }
}

function mapsUrl(venue) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
}

function ordSuffix(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// Unsubscribe URL — points to a simple API route that flips reminder_optin=false
// You'll need to create api/unsubscribe-reminder.js (see note at bottom)
function unsubscribeUrl(guestId) {
  return `${BASE_URL}/api/unsubscribe-reminder?id=${guestId}`;
}

// ── Retry helper ──────────────────────────────────────────
// Tries fn() once, waits delayMs, then tries once more on failure.
async function withRetry(fn, delayMs = 2000) {
  try {
    return await fn();
  } catch (firstErr) {
    console.warn('  ↻ Retrying after error:', firstErr.message);
    await new Promise(r => setTimeout(r, delayMs));
    return await fn(); // throws if second attempt also fails
  }
}

// ── Email template ────────────────────────────────────────

function buildReminderHtml({ party, guest }) {
  const childName    = party.child_name || 'the birthday child';
  const venue        = party.venue || '';
  const partyDate    = party.party_date ? formatDate(party.party_date) : 'soon';
  const age          = party.age || '';
  const guestName    = guest.guest_name || 'there';
  const ageLine      = age
    ? `${childName}'s ${age}${ordSuffix(Number(age))} birthday party`
    : `${childName}'s birthday party`;
  const unsubLink    = unsubscribeUrl(guest.id);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Helvetica,Arial,sans-serif;color:#2a2218;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff9f2;border:1px solid #f5edda;border-radius:20px;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2a2218 0%,#6b5c45 100%);padding:36px 40px;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(250,246,239,0.6);">Tiny Invites</p>
            <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:400;color:#fff;">
              🎈 See you in <strong style="color:#e8d5a3;">3 days!</strong>
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;">Hi <strong>${guestName}</strong>,</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;">
              Just a reminder that <strong>${ageLine}</strong> is in <strong>3 days</strong>! 🎂
            </p>

            <!-- Party details -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5edda;border:1px solid #e8d5a3;border-radius:14px;margin-bottom:24px;">
              <tr><td style="padding:20px 24px;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0;font-size:13px;width:28px;">📅</td>
                    <td style="padding:6px 0;font-size:13px;">${partyDate}</td>
                  </tr>
                  ${venue ? `<tr>
                    <td style="padding:6px 0;font-size:13px;width:28px;">📍</td>
                    <td style="padding:6px 0;font-size:13px;">
                      <a href="${mapsUrl(venue)}" style="color:#c9a84c;">${venue} ↗</a>
                    </td>
                  </tr>` : ''}
                  ${party.parent_email ? `<tr>
                    <td style="padding:6px 0;font-size:13px;width:28px;">✉️</td>
                    <td style="padding:6px 0;font-size:13px;">
                      <a href="mailto:${party.parent_email}" style="color:#c9a84c;">${party.parent_email}</a>
                    </td>
                  </tr>` : ''}
                </table>
              </td></tr>
            </table>

            <p style="margin:0;font-size:15px;line-height:1.7;">See you there for cake and celebrations! 🎉</p>
          </td>
        </tr>

        <!-- Footer with unsubscribe -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f5edda;text-align:center;">
            <p style="margin:0;font-size:11px;color:#a89880;">
              RSVPs made beautiful by <a href="${BASE_URL}" style="color:#c9a84c;text-decoration:none;">Tiny Invites</a> ✨
            </p>
            <p style="margin:8px 0 0;font-size:10px;color:#c8bba8;">
              You received this because you opted in to party reminders when you RSVPd.<br/>
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

export default async function handler(req, res) {

  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const targetDate = dateInDays(DAYS_BEFORE);
    console.log(`[send-reminders] Looking for parties on ${targetDate}`);

    const { data: parties, error: partiesError } = await supabase
      .from('parties')
      .select('*')
      .eq('party_date', targetDate)
      .eq('confirmed', true); // only confirmed parties

    if (partiesError) throw partiesError;

    if (!parties || parties.length === 0) {
      console.log('[send-reminders] No confirmed parties in 3 days.');
      return res.status(200).json({ message: 'No parties in 3 days.' });
    }

    let sent = 0, skipped = 0;
    const failures = [];

    for (const party of parties) {
      const { data: guests, error: guestsError } = await supabase
        .from('guest_responses')
        .select('*')
        .eq('party_id', party.party_id)
        .eq('attending', 'yes')
        .eq('reminder_optin', true)
        .not('guest_email', 'is', null)
        .neq('guest_email', '');

      if (guestsError) throw guestsError;

      console.log(`[send-reminders] "${party.child_name}" — ${guests.length} guest(s) to remind`);

      for (const guest of guests) {
        try {
          // 1-retry on transient failures (network blip, Resend 5xx etc.)
          await withRetry(() => resend.emails.send({
            from:    FROM_EMAIL,
            to:      guest.guest_email,
            subject: `🎉 Just 3 days to go — ${party.child_name}'s party is almost here!`,
            html:    buildReminderHtml({ party, guest }),
            // PECR-compliant List-Unsubscribe header
            headers: {
              'List-Unsubscribe':       `<${unsubscribeUrl(guest.id)}>`,
              'List-Unsubscribe-Post':  'List-Unsubscribe=One-Click',
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
    }

    // ── Admin summary ─────────────────────────────────────
    const failureRows = failures.length
      ? `<br/><strong>Failed addresses:</strong><br/>` +
        failures.map(f => `• ${f.name} &lt;${f.email}&gt; — ${f.error}`).join('<br/>')
      : '';

    try {
      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      ADMIN_EMAIL,
        subject: `⏰ send-reminders ran — ${sent} sent, ${skipped} failed`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#2a2218;line-height:1.8;">
          <strong>Daily reminder cron completed</strong><br/><br/>
          ✅ <strong>Sent:</strong> ${sent}<br/>
          ❌ <strong>Failed (after retry):</strong> ${skipped}<br/>
          📅 <strong>Target party date:</strong> ${targetDate}<br/>
          🕓 <strong>Ran at:</strong> ${new Date().toUTCString()}
          ${failureRows}
        </p>`,
      });
    } catch (adminErr) {
      console.error('Admin summary email failed:', adminErr.message);
    }

    return res.status(200).json({ sent, skipped });

  } catch (err) {
    console.error('[send-reminders] Fatal:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
