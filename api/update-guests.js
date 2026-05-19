import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function sanitiseString(val, maxLen = 200) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const { token, guest_id, action, attending, guest_count, allergies } = body;

    if (!token || !guest_id || !action) {
      return res.status(400).json({ error: 'Missing token, guest_id or action' });
    }

    // ── Verify token belongs to a real confirmed party ────
    const { data: party, error: partyError } = await supabase
      .from('parties')
      .select('party_id')
      .eq('dashboard_token', token)
      .eq('confirmed', true)
      .single();

    if (partyError || !party) {
      return res.status(403).json({ error: 'Invalid dashboard token' });
    }

    // ── Verify guest belongs to this party ────────────────
    const { data: guest, error: guestError } = await supabase
      .from('guest_responses')
      .select('id, party_id')
      .eq('id', guest_id)
      .single();

    if (guestError || !guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    if (guest.party_id !== party.party_id) {
      return res.status(403).json({ error: 'Guest does not belong to this party' });
    }

    // ── Delete ────────────────────────────────────────────
    if (action === 'delete') {
      const { error: deleteError } = await supabase
        .from('guest_responses')
        .delete()
        .eq('id', guest_id);

      if (deleteError) {
        console.error('Delete error:', deleteError.message);
        return res.status(500).json({ error: 'Failed to delete guest' });
      }
      return res.status(200).json({ success: true, action: 'deleted' });
    }

    // ── Edit ──────────────────────────────────────────────
    if (action === 'edit') {
      const updates = {};

      if (attending !== undefined) {
        if (!['yes', 'no', true, false, 'true', 'false'].includes(attending)) {
          return res.status(400).json({ error: 'Invalid attending value' });
        }
        updates.attending = (attending === true || attending === 'true' || attending === 'yes') ? 'yes' : 'no';
      }

      if (guest_count !== undefined) {
        const n = Number(guest_count);
        if (!Number.isInteger(n) || n < 1 || n > 20) {
          return res.status(400).json({ error: 'Invalid guest_count' });
        }
        updates.guest_count = n;
      }

      if (allergies !== undefined) {
        updates.allergies = sanitiseString(allergies, 300);
      }

      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const { error: updateError } = await supabase
        .from('guest_responses')
        .update(updates)
        .eq('id', guest_id);

      if (updateError) {
        console.error('Update error:', updateError.message);
        return res.status(500).json({ error: 'Failed to update guest' });
      }

      return res.status(200).json({ success: true, action: 'updated', updates });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('update-guest error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
