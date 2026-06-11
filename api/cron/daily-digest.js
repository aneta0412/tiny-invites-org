import { createClient } from '@supabase/supabase-js';
import { sendEmail, digestEmailHtml } from '../../lib/send-email.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {

  // Protect the cron endpoint — Vercel sets this header automatically.
  // Fail closed if CRON_SECRET is unset.
  if (!process.env.CRON_SECRET
      || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {

    // Find all responses from today (UTC midnight) up to now
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const now = new Date(); // upper bound = moment cron fires

    const { data: responses, error } = await supabase
      .from('guest_responses')
      .select('*, parties(*)')
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', now.toISOString());

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

    // Hosts get individual emails for the first 15 RSVPs of the day
    // (submit-rsvp.js INDIVIDUAL_NOTIFICATION_LIMIT). The digest exists to
    // bundle the overflow — sending it below that threshold duplicates
    // every notification the host already received.
    const INDIVIDUAL_NOTIFICATION_LIMIT = 15;

    const results = [];

    for (const [party_id, { party, responses: partyResponses }] of Object.entries(byParty)) {
      try {
        if (partyResponses.length <= INDIVIDUAL_NOTIFICATION_LIMIT) {
          results.push({ party_id, skipped: true, reason: 'All responses today were sent individually.' });
          continue;
        }
        if (!party || !party.parent_email || !party.confirmed) {
          results.push({ party_id, skipped: true, reason: 'No host email / party not confirmed.' });
          continue;
        }

        // Normalise attending field ('yes' is the canonical stored value)
        const normalised = partyResponses.map(r => ({
          ...r,
          attending: r.attending === true || r.attending === 'true' || r.attending === 'yes' ? 'yes' : 'no'
        }));

        await sendEmail({
          to:      party.parent_email,
          subject: `📋 ${partyResponses.length} RSVPs today for ${party.child_name}'s party`,
          html:    digestEmailHtml({ party, responses: normalised }),
        });

        results.push({ party_id, sent: true, count: partyResponses.length });
      } catch (err) {
        // One bad party must not abort digests for every other party
        console.error(`[daily-digest] ${party_id}:`, err);
        results.push({ party_id, sent: false, error: err.message });
      }
    }

    return res.status(200).json({ results });

  } catch (err) {
    console.error('[daily-digest] fatal:', err);
    return res.status(500).json({ error: err.message });
  }
}
