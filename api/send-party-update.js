// api/send-party-update.js
// Thin wrapper around lib/send-update.js for direct curl / external calls.
// Auth: Authorization: Bearer <CRON_SECRET>
//
// POST /api/send-party-update
// Body: { party_id, message, subject?, note? }
//
// For dashboard-triggered sends use dashboard-api?action=send-update instead
// (token-authenticated, no CRON_SECRET needed in the browser).

import sendUpdate from '../lib/send-update.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Bearer auth — keeps CRON_SECRET out of the dashboard flow
  // Fail closed if CRON_SECRET is unset (otherwise "Bearer undefined" matches)
  if (!process.env.CRON_SECRET
      || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { party_id, message, subject, note } = req.body || {};

  if (!party_id) {
    return res.status(400).json({ error: 'party_id is required' });
  }

  // Resolve party_id → dashboard_token so we can reuse lib/send-update.js
  // which authenticates via token (same path as the dashboard).
  const { data: party, error } = await supabase
    .from('parties')
    .select('dashboard_token')
    .eq('party_id', party_id)
    .single();

  if (error || !party) {
    return res.status(404).json({ error: 'Party not found' });
  }

  // Delegate — inject token into body so send-update resolves it normally
  req.body = { token: party.dashboard_token, message, subject, note };
  return sendUpdate(req, res);
}
