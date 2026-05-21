// Updated: 2026-05-21
// api/cron/cleanup-inactive-parties.js
//
// Cron endpoint — wire in vercel.json to run daily (e.g. "0 3 * * *").
//
// Hard-deletes parties that have been inactive for more than 60 days. A party
// is "inactive" when its party_date (or created_at as a fallback) is more than
// 60 days in the past. Guest responses are deleted alongside the party.
//
// Auth: same Bearer CRON_SECRET pattern used by daily-digest.
import { createClient } from '@supabase/supabase-js';
import { deletePartyByToken } from '../lib/delete-party.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const INACTIVE_DAYS = 60;

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Cutoff = now - 60 days. Anything with party_date (or created_at fallback)
    // older than this is considered inactive.
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - INACTIVE_DAYS);
    const cutoffIso = cutoff.toISOString();

    // Pull every party with the date fields we need to evaluate. We filter in
    // JS because the "use party_date OR created_at" rule is awkward to express
    // as a single SQL predicate across PostgREST.
    const { data: parties, error } = await supabase
      .from('parties')
      .select('party_id, dashboard_token, party_date, created_at');

    if (error) throw error;

    const toDelete = (parties || []).filter(p => {
      const reference = p.party_date || p.created_at;
      if (!reference) return false; // shouldn't happen, but don't delete if we can't tell
      return new Date(reference) < cutoff;
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
