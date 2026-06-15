// Updated: 2026-06-14
// api/cron/send-reminders.js
// Runs daily at 16:00 UTC via vercel.json cron.
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

// ── Host note block (restyled to match the confirmation email) ─────────────

function hostNoteBlock(note) {
  if (!note) return '';
  return `
    <table width="100%" cellpadding="0" cellspacing="0"
           style="margin:22px 0 0;background:#faf4e8;border:1px solid #f0e7d4;border-left:3px solid #c9a84c;border-radius:12px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 7px;font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#b6a079;">Note from the host</p>
        <p style="margin:0;font-size:0.86rem;line-height:1.7;color:#2a2218;white-space:pre-line;">${esc(note)}</p>
      </td></tr>
    </table>`;
}

// ── Reminder email template (premium, compact) ─────────────────────────────

function buildReminderHtml({ party, guest, note }) {
  const childName = esc(party.child_name || 'the birthday child');
  const venue     = party.venue || '';
  const partyDate = party.party_date ? formatDate(party.party_date) : 'soon';
  const age       = party.age || '';
  const guestName = esc(guest.guest_name || 'there');
  const ageDesc   = age ? `${esc(String(age))}${ordSuffix(Number(age))} birthday` : 'birthday';
  const unsubLink = unsubscribeUrl(guest.id);

  // Single tidy details panel — When / Where / Host.
  const rows = [
    ['When', partyDate],
    venue
      ? ['Where', `<a href="${mapsUrl(venue)}" style="color:#c9a84c;text-decoration:none;">${esc(venue)}&nbsp;&rarr;</a>`]
      : null,
    party.parent_email
      ? ['Host', `<a href="mailto:${esc(party.parent_email)}" style="color:#c9a84c;text-decoration:none;">${esc(party.parent_email)}</a>`]
      : null,
  ].filter(Boolean);

  const panel = `<table width="100%" cellpadding="0" cellspacing="0"
    style="margin:24px 0 0;background:#faf4e8;border:1px solid #f0e7d4;border-radius:12px;padding:4px 20px;">
    ${rows.map((r, i, a) => {
      const b = i < a.length - 1 ? 'border-bottom:1px solid #f0e7d4;' : '';
      return `<tr>
        <td style="padding:12px 0;${b}font-size:0.64rem;letter-spacing:0.14em;text-transform:uppercase;color:#b6a079;white-space:nowrap;">${r[0]}</td>
        <td style="padding:12px 0;${b}text-align:right;font-size:0.88rem;color:#2a2218;">${r[1]}</td>
      </tr>`;
    }).join('')}
  </table>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f7f1e6;font-family:Arial,Helvetica,sans-serif;color:#2a2218;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f1e6;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:22px;">
    <span style="font-family:Georgia,'Times New Roman',serif;font-size:1.25rem;font-style:italic;color:#c9a84c;">Tiny&nbsp;Invites</span>
  </td></tr>
  <tr><td style="background:#fffaf3;border:1px solid #efe2cb;border-top:3px solid #c9a84c;border-radius:18px;padding:40px 42px 36px;">

    <!-- Medallion: the countdown number is the signature element -->
    <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 22px;">
      <tr><td style="padding:6px;background:#f1e6cb;border-radius:50%;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:58px;height:58px;background:#c9a84c;border-radius:50%;text-align:center;vertical-align:middle;color:#fffaf0;font-size:25px;line-height:58px;font-family:Georgia,serif;">${DAYS_BEFORE}</td>
        </tr></table>
      </td></tr>
    </table>

    <p style="text-align:center;font-size:0.62rem;letter-spacing:0.24em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">${DAYS_BEFORE} days to go</p>
    <h1 style="text-align:center;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:1.78rem;color:#2a2218;margin:0 0 14px;line-height:1.28;">Almost time, <em style="color:#c9a84c;font-style:normal;">${guestName}</em></h1>
    <p style="text-align:center;font-size:0.9rem;color:#6b5c45;line-height:1.7;margin:0 auto;max-width:380px;">${childName}'s ${ageDesc} is just ${DAYS_BEFORE} days away. Here's everything to keep handy.</p>

    ${panel}
    ${hostNoteBlock(note)}

    ${venue
      ? `<p style="text-align:center;margin:22px 0 0;">
           <a href="${mapsUrl(venue)}" style="display:inline-block;font-size:0.8rem;letter-spacing:0.04em;color:#8a6d2f;text-decoration:none;border:1px solid #e3d3a8;border-radius:999px;padding:10px 22px;">Open in Maps</a>
         </p>`
      : ''}

  </td></tr>
  <tr><td style="text-align:center;padding:22px 0 0;">
    <p style="font-size:0.68rem;color:#a89880;margin:0;line-height:1.6;">Sent with care by <span style="color:#c9a84c;">Tiny Invites</span><br><a href="${BASE_URL}" style="color:#a89880;text-decoration:none;">tinyinvites.org</a></p>
    <p style="font-size:0.62rem;color:#c8bba8;margin:10px 0 0;line-height:1.6;">You're receiving this because you RSVP'd yes to this party.<br><a href="${unsubLink}" style="color:#c8bba8;text-decoration:underline;">Unsubscribe from reminders</a></p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

// ── Main handler (logic unchanged) ─────────────────────────

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
            subject: `${party.child_name}'s party is in ${DAYS_BEFORE} days`,
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
          📅 <strong>Target party date:</strong> ${targetDate}<br/>
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
