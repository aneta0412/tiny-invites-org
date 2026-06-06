import { createClient } from '@supabase/supabase-js';
import { sendEmail, digestEmailHtml } from './send-email.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {

  // Protect the cron endpoint — Vercel sets this header automatically
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
      // Only send digest if there are 2+ responses today (first was already sent instantly)
      if (partyResponses.length < 2) {
        results.push({ party_id, skipped: true, reason: 'Only 1 response today, already sent.' });
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

    return res.status(200).json({ results });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
