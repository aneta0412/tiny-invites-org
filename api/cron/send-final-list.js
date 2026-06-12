// Updated: 2026-06-05
// cron/send-final-list.js
//
// Runs daily at 09:00 UTC via vercel.json.
// Finds every party whose rsvp_cutoff = today, then emails the host
// their final confirmed guest list with email addresses + a CSV attachment.

import { createClient } from '@supabase/supabase-js';
import { Resend }       from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend      = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL  = 'Tiny Invites <hello@tinyinvites.org>';
const ADMIN_EMAIL = 'hello@tinyinvites.org';
const BASE_URL    = 'https://tinyinvites.org';

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      weekday:'long', day:'numeric', month:'long', year:'numeric',
    });
  } catch { return dateStr || ''; }
}

function ordSuffix(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

// ── Build CSV ─────────────────────────────────────────────

function buildCsv(responses) {
  const rows = [['Name', 'Attending', 'Guests', 'Email', 'Dietary notes']];
  for (const r of responses) {
    const attending = r.attending === true || r.attending === 'true' || r.attending === 'yes' ? 'Yes' : 'No';
    rows.push([
      r.guest_name    || '',
      attending,
      attending === 'Yes' ? (r.guest_count ?? 1) : '',
      r.guest_email   || '',
      r.allergies     || '',
    ]);
  }
  return rows
    .map(row => row.map(cell => {
      let v = String(cell).replace(/"/g, '""');
      // Neutralise spreadsheet formula injection (=, +, -, @ at cell start)
      if (/^[=+\-@]/.test(v)) v = `'${v}`;
      return `"${v}"`;
    }).join(','))
    .join('\r\n');
}

// ── Build HTML email ──────────────────────────────────────

function finalListHtml({ party, yes, no, responses, dashUrl }) {
  const childName = esc(party.child_name || 'your child');
  const ageStr    = party.age ? `${ordSuffix(party.age)} birthday` : 'party';
  const partyDate = party.party_date ? formatDate(party.party_date) : '';

  const guestRows = responses
    .filter(r => r.attending === true || r.attending === 'true' || r.attending === 'yes')
    .map(r => `
      <tr>
        <td style="padding:9px 12px;font-size:0.82rem;color:#2a2218;border-bottom:1px solid #f5edda;">${esc(r.guest_name || '—')}</td>
        <td style="padding:9px 12px;font-size:0.78rem;color:#6b5c45;border-bottom:1px solid #f5edda;text-align:center;">${r.guest_count ?? 1}</td>
        <td style="padding:9px 12px;font-size:0.74rem;color:#6b5c45;border-bottom:1px solid #f5edda;">
          ${r.guest_email ? `<a href="mailto:${esc(r.guest_email)}" style="color:#c9a84c;text-decoration:none;">${esc(r.guest_email)}</a>` : '—'}
        </td>
        <td style="padding:9px 12px;font-size:0.74rem;color:#6b5c45;border-bottom:1px solid #f5edda;">${r.allergies ? esc(r.allergies) : '—'}</td>
      </tr>`)
    .join('');

  const heroBlock = party.photo_url
    ? `<tr><td style="padding:0;overflow:hidden;"><img src="${party.photo_url}" alt="Party" style="width:100%;max-height:200px;object-fit:cover;display:block;border-radius:12px 12px 0 0;"></td></tr>`
    : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:16px;">
    <span style="font-family:Georgia,serif;font-size:1.2rem;font-style:italic;color:#c9a84c;">Tiny Invites</span>
  </td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:14px;overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${heroBlock}
      <tr><td style="padding:32px 40px 28px;">
        <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">RSVPs closed 🔒</p>
        <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 10px;line-height:1.3;">Your final guest list for ${childName}'s ${ageStr}</h1>
        ${partyDate ? `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 18px;">📅 <strong>${partyDate}</strong></p>` : ''}
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5edda;border-radius:10px;margin-bottom:24px;">
          <tr>
            <td style="padding:12px 16px;text-align:center;">
              <strong style="font-family:Georgia,serif;font-size:2rem;color:#2a2218;">${yes}</strong>
              <span style="display:block;font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:#8c7b63;">Confirmed</span>
            </td>
            <td style="padding:12px 16px;text-align:center;border-left:1px solid #e8d5a3;">
              <strong style="font-family:Georgia,serif;font-size:2rem;color:#2a2218;">${no}</strong>
              <span style="display:block;font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:#8c7b63;">Declined</span>
            </td>
          </tr>
        </table>
        <p style="font-size:0.82rem;color:#6b5c45;margin:0 0 16px;line-height:1.6;">The full list with contact details and dietary notes is below, and a CSV file is attached so you can share it with your venue or caterer.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f5edda;border-radius:8px;overflow:hidden;margin-bottom:24px;">
          <thead>
            <tr style="background:#f5edda;">
              <th style="padding:8px 12px;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;color:#8c7b63;text-align:left;">Name</th>
              <th style="padding:8px 12px;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;color:#8c7b63;text-align:center;">Guests</th>
              <th style="padding:8px 12px;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;color:#8c7b63;text-align:left;">Email</th>
              <th style="padding:8px 12px;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;color:#8c7b63;text-align:left;">Dietary</th>
            </tr>
          </thead>
          <tbody>${guestRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#8c7b63;font-size:0.82rem;">No confirmed guests yet.</td></tr>'}</tbody>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
          <a href="${dashUrl}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">📊 Open dashboard →</a>
        </td></tr></table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;padding:20px 0 0;">
    <p style="font-size:0.68rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span> · <a href="${BASE_URL}" style="color:#a89880;text-decoration:none;">tinyinvites.org</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
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
   
    // Find parties whose RSVP cutoff is today
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const cutoffDate = yesterday.toISOString().slice(0, 10); // YYYY-MM-DD UTC

    // Find parties whose RSVP cutoff was yesterday (cutoff day has now passed)
    const { data: parties, error: partyErr } = await supabase
    .from('parties')
    .select('*')
    .eq('rsvp_cutoff', cutoffDate)
    .eq('confirmed', true);
    if (partyErr) throw partyErr;

    if (!parties || parties.length === 0) {
      return res.status(200).json({ message: 'No parties to send finals' });
    }

    const results = [];

    for (const party of parties) {
      try {
        const { data: responses } = await supabase
          .from('guest_responses')
          .select('*')
          .eq('party_id', party.party_id)
          .order('created_at', { ascending: true });

        const all  = responses || [];
        const norm = all.map(r => ({
          ...r,
          attending: r.attending === true || r.attending === 'true' || r.attending === 'yes' ? 'yes' : 'no',
        }));

        const yes = norm.filter(r => r.attending === 'yes').length;
        const no  = norm.filter(r => r.attending === 'no').length;

        const dashUrl = `${BASE_URL}/dashboard_page.html?token=${party.dashboard_token}`;
        const csv     = buildCsv(norm);
        const csvB64  = Buffer.from(csv, 'utf8').toString('base64');

        await resend.emails.send({
          from:    FROM_EMAIL,
          to:      party.parent_email,
          subject: `🔒 RSVPs closed — final guest list for ${party.child_name}'s party`,
          html:    finalListHtml({ party, yes, no, responses: norm, dashUrl }),
          attachments: [{
            filename: `guest-list-${(party.child_name || 'party').toLowerCase().replace(/\s+/g, '-')}.csv`,
            content:  csvB64,
          }],
        });

        results.push({ party_id: party.party_id, sent: true, yes, no });
      } catch (err) {
        console.error(`[send-final-list] ${party.party_id}:`, err.message);
        results.push({ party_id: party.party_id, sent: false, error: err.message });
      }
    }

    // Admin summary
    try {
      const sent   = results.filter(r => r.sent).length;
      const failed = results.filter(r => !r.sent).length;
      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      ADMIN_EMAIL,
        subject: `🔒 send-final-list ran — ${sent} sent, ${failed} failed`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#2a2218;line-height:1.8;">
          <strong>Final guest list cron completed</strong><br/><br/>
          ✅ <strong>Emails sent:</strong> ${sent}<br/>
          ❌ <strong>Failed:</strong> ${failed}<br/>
          📅 <strong>Cutoff date:</strong> ${cutoffDate}<br/>
          🕓 <strong>Ran at:</strong> ${new Date().toUTCString()}
        </p>`,
      });
    } catch (adminErr) {
      console.error('[send-final-list] admin summary failed:', adminErr.message);
    }

    return res.status(200).json({ cutoffDate, parties: parties.length, results });

  } catch (err) {
    console.error('[send-final-list] fatal:', err);
    return res.status(500).json({ error: err.message });
  }
}
