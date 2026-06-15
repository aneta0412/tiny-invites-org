// Updated: 2026-06-15
// lib/update-party.js
//
// Lets a host correct the party START TIME and/or VENUE from their dashboard
// after the party has gone live. Previously a simple time/venue typo meant
// deleting the whole party and recreating it (losing the RSVP link + QR code) —
// a real source of churn. The date and photo stay locked (invites already
// carry them); time and venue are safe to amend and just need guests told.
//
// Route: POST /api/dashboard-api?action=update-party
// Body:  { token, party_time?, venue? }   (token = the private dashboard_token)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// party_time is the start time, stored as 24-hour "HH:MM".
function isValidPartyTime(val) {
  return typeof val === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(val.trim());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, party_time, venue, party_duration_min } = req.body || {};

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ error: 'Missing token' });
    }

    // Build the update from only the fields that were supplied.
    const updates = {};

    if (party_time !== undefined && party_time !== null && party_time !== '') {
      if (!isValidPartyTime(party_time)) {
        return res.status(400).json({ error: 'Invalid party_time — use HH:MM (24-hour)' });
      }
      updates.party_time = party_time.trim();
    }

    if (party_duration_min !== undefined && party_duration_min !== null && party_duration_min !== '') {
      const dur = Number(party_duration_min);
      if (!Number.isInteger(dur) || dur < 15 || dur > 480) {
        return res.status(400).json({ error: 'Invalid party_duration_min — minutes between 15 and 480' });
      }
      updates.party_duration_min = dur;
    }

    if (venue !== undefined) {
      if (venue === null || (typeof venue === 'string' && !venue.trim())) {
        updates.venue = null;                       // allow clearing the venue
      } else if (typeof venue === 'string') {
        updates.venue = venue.trim().slice(0, 200);
      } else {
        return res.status(400).json({ error: 'Invalid venue' });
      }
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nothing to update — provide party_time and/or venue' });
    }

    const cleanToken = token.trim();

    // Verify the token maps to a real party before writing.
    const { data: party, error: lookupErr } = await supabase
      .from('parties')
      .select('party_id')
      .eq('dashboard_token', cleanToken)
      .single();

    if (lookupErr || !party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    const { error: updateErr } = await supabase
      .from('parties')
      .update(updates)
      .eq('dashboard_token', cleanToken);

    if (updateErr) {
      console.error('[update-party] update error:', updateErr.message);
      return res.status(500).json({ error: 'Failed to update party details' });
    }

    return res.status(200).json({ success: true, updated: updates });

  } catch (err) {
    console.error('[update-party] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
