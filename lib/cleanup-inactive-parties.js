// Updated: 2026-05-21
// api/cleanup-inactive-parties.js
//
// Cron endpoint — wire in vercel.json to run daily (e.g. "0 3 * * *").
//
// Hard-deletes parties whose party_date was more than 60 days ago. Parties
// with no party_date set are deliberately left alone — a host who hasn't
// told us the date may have a party scheduled far in the future, so we'd
// rather leak storage than nuke an upcoming event. (Use the unconfirmed-
// cleanup pass below to catch never-confirmed parties separately.)
//
// Guest responses are deleted alongside the party via deletePartyByToken.
//
// Auth: same Bearer CRON_SECRET pattern used by daily-digest.
import { createClient } from '@supabase/supabase-js';
import { deletePartyByToken } from './delete-party.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const INACTIVE_DAYS          = 60;   // days after party_date before we delete
const UNCONFIRMED_GRACE_DAYS = 30;   // days an unconfirmed party can sit around

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Cutoff for parties that have already happened.
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - INACTIVE_DAYS);
    const cutoffIso = cutoff.toISOString();

    // Cutoff for parties that never got confirmed — these were created but
    // the host never clicked the confirmation link, so they're abandoned.
    const unconfirmedCutoff = new Date();
    unconfirmedCutoff.setUTCDate(unconfirmedCutoff.getUTCDate() - UNCONFIRMED_GRACE_DAYS);

    const { data: parties, error } = await supabase
      .from('parties')
      .select('party_id, dashboard_token, party_date, created_at, confirmed');

    if (error) throw error;

    const toDelete = (parties || []).filter(p => {
      // Case A: confirmed party with a known date — delete 60d after the date.
      if (p.party_date) {
        return new Date(p.party_date) < cutoff;
      }
      // Case B: unconfirmed and abandoned — delete after 30d.
      if (!p.confirmed && p.created_at && new Date(p.created_at) < unconfirmedCutoff) {
        return true;
      }
      // Case C: confirmed but no date set — leave alone, host may have a
      // future event we don't know about.
      return false;
    });

    const results = [];
    for (const p of toDelete) {
      try {
        await deletePartyByToken(p.dashboard_token);
        results.push({ party_id: p.party_id, deleted: true });
      } catch (err) {
        console.error(`cleanup: failed to delete ${p.party_id}:`, err.message);
        results.push({ party_id: p.party_id, deleted: false, error: err.message });
      }
    }

    return res.status(200).json({
      cutoff: cutoffIso,
      scanned: parties?.length || 0,
      deleted: results.filter(r => r.deleted).length,
      failures: results.filter(r => !r.deleted).length,
      results,
    });

  } catch (err) {
    console.error('cleanup-inactive-parties error:', err);
    return res.status(500).json({ error: err.message });
  }
}
