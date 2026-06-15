// Updated: 2026-06-15
// lib/extend-cutoff.js
// Lets a host push their RSVP cutoff date later (or reopen a closed party).
// Called via /api/dashboard-api?action=extend-cutoff  (register in the router).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, new_cutoff } = req.body || {};

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ error: 'Missing token' });
    }
    if (!new_cutoff) {
      return res.status(400).json({ error: 'Missing new_cutoff' });
    }

    const newDate = new Date(new_cutoff);
    if (isNaN(newDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }

    const cleanToken = token.trim();

    // ── Look up the party (token is the private dashboard_token) ──
    const { data: party, error: lookupErr } = await supabase
      .from('parties')
      .select('*')
      .eq('dashboard_token', cleanToken)
      .single();

    if (lookupErr || !party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    // ── Validate: must be a future date, on or before the party itself ──
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (newDate < today) {
      return res.status(400).json({ error: 'The new deadline must be in the future' });
    }

    if (party.party_date) {
      const partyDay = new Date(party.party_date);
      partyDay.setHours(23, 59, 59, 999);
      if (newDate > partyDay) {
        return res.status(400).json({ error: 'The deadline cannot be after the party date' });
      }
    }

    // ── Update the cutoff ──
    const iso = newDate.toISOString();
    const { error: updateErr } = await supabase
      .from('parties')
      .update({ rsvp_cutoff: iso })
      .eq('dashboard_token', cleanToken);

    if (updateErr) {
      console.error('extend-cutoff update error:', updateErr.message);
      return res.status(500).json({ error: 'Failed to update the deadline' });
    }

    return res.status(200).json({ success: true, rsvp_cutoff: iso });

  } catch (err) {
    console.error('extend-cutoff error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
