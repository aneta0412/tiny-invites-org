/**
 * lib/send-reminders.js
 *
 * Scheduled function — run once daily (e.g. via Netlify Scheduled Functions,
 * a cron job, or any task scheduler at 09:00 local / UTC).
 *
 * What it does:
 *   1. Finds every party whose date is exactly 3 days from today.
 *   2. Fetches all confirmed (attending = 'yes') RSVPs for those parties
 *      where the guest opted in to reminders (reminder_optin = true)
 *      and has a valid email address.
 *   3. Sends each guest a detailed reminder email via Resend.
 *
 * Environment variables required (same as the rest of the project):
 *   RESEND_API_KEY   — your Resend secret key
 *   NEON_DATABASE_URL (or DATABASE_URL) — Postgres connection string
 *   FROM_EMAIL       — verified sender address, e.g. hello@tinyinvites.org
 *
 * Netlify scheduled function export (handler + schedule):
 *   To schedule at 09:00 UTC daily, add to netlify.toml:
 *
 *     [functions."send-reminders"]
 *       schedule = "0 9 * * *"
 *
 * Usage as a plain Node script (for testing):
 *   node lib/send-reminders.js
 */

// ─── Dependencies ────────────────────────────────────────────────────────────
// Uses the same stack as the rest of the project.
// Install once: npm install @neondatabase/serverless resend
const { neon }  = require('@neondatabase/serverless');
const { Resend } = require('resend');

// ─── Config ──────────────────────────────────────────────────────────────────
const DATABASE_URL  = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL    = process.env.FROM_EMAIL || 'Tiny Invites <hello@tinyinvites.org>';
const DAYS_BEFORE   = 3; // how many days ahead to remind

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns YYYY-MM-DD for today + n days in UTC */
function dateInDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Format a date string like "Saturday, 14 June 2025" */
function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/** Google Maps search URL for a venue string */
function mapsUrl(venue) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
}

// ─── Email template ──────────────────────────────────────────────────────────

/**
 * Builds a rich HTML reminder email for a single guest.
 *
 * @param {object} party  — row from the parties table
 * @param {object} guest  — row from the rsvps table
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildReminderEmail(party, guest) {
  const childName  = party.child_name  || 'the birthday child';
  const venue      = party.venue       || 'the venue';
  const partyDate  = party.party_date  ? formatDate(party.party_date) : 'soon';
  const hostEmail  = party.parent_email || '';
  const hostPhone  = party.phone_number || '';
  const age        = party.age         || '';
  const guestName  = guest.guest_name  || 'there';

  const ageLine    = age ? `${childName}'s ${age}${ordSuffix(Number(age))} birthday` : `${childName}'s birthday party`;
  const mapLink    = party.venue ? `<a href="${mapsUrl(party.venue)}" style="color:#c9a84c;text-decoration:none;font-weight:500;">${venue} ↗</a>` : venue;
  const hostBlock  = (hostEmail || hostPhone)
    ? `<p style="margin:0 0 6px;">Any questions? Reach the host${hostEmail ? ` at <a href="mailto:${hostEmail}" style="color:#c9a84c;">${hostEmail}</a>` : ''}${hostPhone ? ` or call <a href="tel:${hostPhone}" style="color:#c9a84c;">${hostPhone}</a>` : ''}.</p>`
    : '';

  const subject = `🎉 Just 3 days to go — ${childName}'s party is almost here!`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-weight:300;color:#2a2218;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff9f2;border:1px solid #f5edda;border-radius:20px;overflow:hidden;">

        <!-- Hero band -->
        <tr>
          <td style="background:linear-gradient(135deg,#2a2218 0%,#6b5c45 100%);padding:36px 40px;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(250,246,239,0.6);">Tiny Invites</p>
            <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:400;color:#fff;line-height:1.2;">
              🎈 See you in <strong style="color:#e8d5a3;">3 days!</strong>
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#2a2218;">
              Hi <strong>${guestName}</strong>,
            </p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#2a2218;">
              Just a friendly reminder that <strong>${ageLine}</strong> is coming up in <strong>3 days</strong>. We can't wait to celebrate with you! 🎂
            </p>

            <!-- Party details box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5edda;border:1px solid #e8d5a3;border-radius:14px;margin-bottom:24px;">
              <tr><td style="padding:20px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  ${partyDate ? `
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#6b5c45;vertical-align:top;width:28px;">📅</td>
                    <td style="padding:6px 0;font-size:13px;color:#2a2218;">${partyDate}</td>
                  </tr>` : ''}
                  ${party.venue ? `
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#6b5c45;vertical-align:top;width:28px;">📍</td>
                    <td style="padding:6px 0;font-size:13px;color:#2a2218;">${mapLink} &nbsp;<span style="font-size:11px;color:#a89880;">(tap to open in Maps)</span></td>
                  </tr>` : ''}
                  ${hostEmail ? `
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#6b5c45;vertical-align:top;width:28px;">✉️</td>
                    <td style="padding:6px 0;font-size:13px;color:#2a2218;"><a href="mailto:${hostEmail}" style="color:#c9a84c;">${hostEmail}</a></td>
                  </tr>` : ''}
                  ${hostPhone ? `
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#6b5c45;vertical-align:top;width:28px;">📱</td>
                    <td style="padding:6px 0;font-size:13px;color:#2a2218;"><a href="tel:${hostPhone}" style="color:#c9a84c;">${hostPhone}</a></td>
                  </tr>` : ''}
                </table>
              </td></tr>
            </table>

            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#2a2218;">
              See you there for cake, laughter, and all the good things! 🎉
            </p>
            ${hostBlock ? `<p style="margin:0 0 0;font-size:13px;line-height:1.65;color:#6b5c45;">${hostBlock}</p>` : ''}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f5edda;text-align:center;">
            <p style="margin:0;font-size:11px;color:#a89880;">RSVPs made beautiful by <a href="https://tinyinvites.org" style="color:#c9a84c;text-decoration:none;">Tiny Invites</a> ✨</p>
            <p style="margin:6px 0 0;font-size:10px;color:#c8bba8;">You're receiving this because you opted in to party reminders when you RSVPd.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${guestName},

Just a reminder — ${ageLine} is in 3 days!

📅 ${partyDate}
📍 ${venue}${party.venue ? `\n   Maps: ${mapsUrl(party.venue)}` : ''}
${hostEmail ? `✉️  ${hostEmail}` : ''}
${hostPhone ? `📱  ${hostPhone}` : ''}

See you there!

— Tiny Invites (tinyinvites.org)
You're receiving this because you opted in to party reminders when you RSVPd.`;

  return { subject, html, text };
}

// ─── Ordinal suffix helper ────────────────────────────────────────────────────
function ordSuffix(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// ─── Main logic ───────────────────────────────────────────────────────────────

async function sendReminders() {
  if (!DATABASE_URL)   throw new Error('Missing NEON_DATABASE_URL / DATABASE_URL');
  if (!RESEND_API_KEY) throw new Error('Missing RESEND_API_KEY');

  const sql    = neon(DATABASE_URL);
  const resend = new Resend(RESEND_API_KEY);

  const targetDate = dateInDays(DAYS_BEFORE);
  console.log(`[send-reminders] Looking for parties on ${targetDate} (${DAYS_BEFORE} days from now)`);

  // ── 1. Find parties happening in exactly DAYS_BEFORE days ──────────────────
  // Casts party_date to date to handle both DATE and TIMESTAMP columns.
  const parties = await sql`
    SELECT *
    FROM   parties
    WHERE  party_date::date = ${targetDate}::date
  `;

  if (!parties.length) {
    console.log('[send-reminders] No parties found for that date. Nothing to do.');
    return { sent: 0, skipped: 0 };
  }

  console.log(`[send-reminders] Found ${parties.length} party/parties on ${targetDate}`);

  let sent    = 0;
  let skipped = 0;

  for (const party of parties) {
    // ── 2. Get opted-in, confirmed guests with an email ──────────────────────
    // Column names: guest_email, reminder_optin, attending
    // Adjust if your schema uses different names.
    const guests = await sql`
      SELECT *
      FROM   rsvps
      WHERE  party_id      = ${party.party_id || party.id}
        AND  attending      = 'yes'
        AND  reminder_optin = true
        AND  guest_email   IS NOT NULL
        AND  guest_email   != ''
    `;

    console.log(`[send-reminders] Party "${party.child_name}" — ${guests.length} reminder-opted-in guest(s)`);

    for (const guest of guests) {
      try {
        const { subject, html, text } = buildReminderEmail(party, guest);

        await resend.emails.send({
          from:    FROM_EMAIL,
          to:      guest.guest_email,
          subject,
          html,
          text,
          tags: [
            { name: 'type',     value: 'guest-reminder' },
            { name: 'party_id', value: String(party.party_id || party.id) },
          ],
        });

        console.log(`  ✓ Sent to ${guest.guest_email} (${guest.guest_name})`);
        sent++;

      } catch (err) {
        // Don't let one failed send kill the rest
        console.error(`  ✗ Failed for ${guest.guest_email} (${guest.guest_name}):`, err.message);
        skipped++;
      }
    }
  }

  console.log(`[send-reminders] Done — ${sent} sent, ${skipped} failed/skipped`);
  return { sent, skipped };
}

// ─── Netlify Scheduled Function export ───────────────────────────────────────
// Netlify calls handler() on schedule. The function also works as a plain
// Node script: `node lib/send-reminders.js`

const handler = async (event, context) => {
  try {
    const result = await sendReminders();
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[send-reminders] Fatal error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

module.exports = { handler, sendReminders };

// Allow direct execution: node lib/send-reminders.js
if (require.main === module) {
  sendReminders()
    .then(r => { console.log('Result:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
