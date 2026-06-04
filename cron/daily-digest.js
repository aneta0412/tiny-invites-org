// Updated: 2026-05-21
// api/cron/daily-digest.js — wired in vercel.json to run daily at 20:00 UTC (8pm).
//
// Sends an end-of-day digest of today's RSVPs to each host, but only when
// MORE THAN 15 responses came in for a single party that day. Parties with
// 15 or fewer responses today are skipped — those were already covered by
// the instant per-RSVP notifications in submit-rsvp.js.
import { createClient } from '@supabase/supabase-js';
import { sendEmail, digestEmailHtml } from '../lib/send-email.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Threshold: fire the digest only when today's response count exceeds this.
const DIGEST_THRESHOLD = 3;

export default async function handler(req, res) {

  // Protect the cron endpoint — Vercel sets this header automatically.
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {

    // Find all responses from today (UTC)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: responses, error } = await supabase
      .from('guest_responses')
      .select('*, parties(*)')
      .gte('created_at', todayStart.toISOString());

    if (error) throw error;
    if (!responses || responses.length === 0) {
      return res.status(200).json({ message: 'No responses today, no digest sent.' });
    }

    // Group by party_id
    const byParty = {};
    responses.forEach(r => {
      if (!byParty[r.party_id]) byParty[r.party_id] = { party: r.parties, responses: [] };
      byParty[r.party_id].responses.push(r);
    });

    const results = [];

    for (const [party_id, { party, responses: partyResponses }] of Object.entries(byParty)) {
      // Only send digest if MORE THAN 15 responses came in today.
      // 1-15: individual notifications already went out → no digest needed.
      if (partyResponses.length <= DIGEST_THRESHOLD) {
        results.push({
          party_id,
          skipped: true,
          reason:  `Only ${partyResponses.length} response${partyResponses.length === 1 ? '' : 's'} today (threshold: >${DIGEST_THRESHOLD}).`,
        });
        continue;
      }

      // Normalise attending field
      const normalised = partyResponses.map(r => ({
        ...r,
        attending: r.attending === true || r.attending === 'true' ? 'yes' : 'no'
      }));

      await sendEmail({
        to:      party.parent_email,
        subject: `📋 ${partyResponses.length} RSVPs today for ${party.child_name}'s party`,
        html:    digestEmailHtml({ party, responses: normalised }),
      });

      results.push({ party_id, sent: true, count: partyResponses.length });
    }

    // ── Admin summary ─────────────────────────────────────
    const sentCount    = results.filter(r => r.sent).length;
    const skippedCount = results.filter(r => r.skipped).length;

    try {
      await resend.emails.send({
        from:    'Tiny Invites <hello@tinyinvites.org>',
        to:      'hello@tinyinvites.org',
        subject: `📋 daily-digest ran — ${sentCount} sent, ${skippedCount} skipped`,
        html:    `<p style="font-family:Arial,sans-serif;font-size:14px;color:#2a2218;">
          <strong>Daily digest cron completed</strong><br/><br/>
          ✅ <strong>Digests sent:</strong> ${sentCount}<br/>
          ⏭️ <strong>Parties skipped</strong> (≤15 responses): ${skippedCount}<br/>
          🕓 <strong>Ran at:</strong> ${new Date().toUTCString()}
        </p>`,
      });
    } catch (adminErr) {
      console.error('Admin summary email failed:', adminErr.message);
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error('daily-digest error:', err);
    return res.status(500).json({ error: err.message });
  }
}
