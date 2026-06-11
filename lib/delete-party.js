// Updated: 2026-05-21
// lib/delete-party.js
//
// User-initiated party deletion. Routed at:
//   POST /api/party?action=delete-party
//
// Required body: { token: <dashboard_token>, confirmed: true }
//
// The two-field requirement is a deliberate guard against accidental clicks —
// the email footer link points to /delete-party.html?token=... and the
// frontend page asks "Are you sure?" before calling this endpoint with
// confirmed:true.
//
// Automatic deletion (60+ days inactive) is handled by the cron at
// api/cron/cleanup-inactive-parties.js and does NOT go through this route.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Hard-delete a party and all its guest responses.
 * Returns { ok: true } on success or throws.
 * Exported so the cleanup cron can reuse the same delete order.
 */
export async function deletePartyByToken(token) {
  // Find the party first so we can target its guest_responses by party_id.
  const { data: party, error: lookupErr } = await supabase
    .from('parties')
    .select('party_id, dashboard_token')
    .eq('dashboard_token', token)
    .single();

  if (lookupErr || !party) {
    const err = new Error('Party not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Delete dependent rows first in case FK cascade isn't configured.
  const { error: respErr } = await supabase
    .from('guest_responses')
    .delete()
    .eq('party_id', party.party_id);

  if (respErr) {
    console.error('delete-party: failed to delete guest_responses:', respErr.message);
    throw new Error('Failed to delete guest responses');
  }

  const { error: partyErr } = await supabase
    .from('parties')
    .delete()
    .eq('party_id', party.party_id);

  if (partyErr) {
    console.error('delete-party: failed to delete party row:', partyErr.message);
    throw new Error('Failed to delete party');
  }

  return { ok: true, party_id: party.party_id };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token.trim() : null;
    const confirmed = body.confirmed === true || body.confirmed === 'true';

    if (!token) {
      return res.status(400).json({ error: 'Missing dashboard token' });
    }

    // Confirmation flag is required for user-initiated deletes.
    if (!confirmed) {
      return res.status(400).json({
        error: 'Deletion not confirmed',
        hint:  'Resend with { token, confirmed: true } after the user confirms on the delete page.',
      });
    }

    try {
      const result = await deletePartyByToken(token);
      return res.status(200).json({ success: true, party_id: result.party_id });
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Party not found or already deleted' });
      }
      throw err;
    }

  } catch (err) {
    console.error('delete-party error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
