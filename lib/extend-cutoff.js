// Updated: 2026-06-15
// lib/extend-cutoff.js
// Lets a host push their RSVP cutoff date later (or reopen a closed party).
// Called via /api/dashboard-api?action=extend-cutoff  (register in the router).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Today's calendar date in Europe/London as "YYYY-MM-DD", for timezone-stable
// comparison against UK party/cutoff dates.
function londonTodayISO() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day}`;
}

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

    // Normalise to a date-only "YYYY-MM-DD" string (the picker sends this).
    const newCutoff = String(new_cutoff).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newCutoff) || isNaN(new Date(newCutoff).getTime())) {
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

    // ── Validate: must be today or later (Europe/London), on or before the
    // party itself. All comparisons are date strings to stay timezone-stable. ──
    const todayLondon = londonTodayISO();
    if (newCutoff < todayLondon) {
      return res.status(400).json({ error: 'The new deadline must be in the future' });
    }

    if (party.party_date && newCutoff > String(party.party_date).slice(0, 10)) {
      return res.status(400).json({ error: 'The deadline cannot be after the party date' });
    }

    // ── Update the cutoff ──
    // Stored as date-only (YYYY-MM-DD) to match how go-live.js writes
    // rsvp_cutoff and how submit-rsvp.js reads it.
    const { error: updateErr } = await supabase
      .from('parties')
      .update({ rsvp_cutoff: newCutoff })
      .eq('dashboard_token', cleanToken);

    if (updateErr) {
      console.error('extend-cutoff update error:', updateErr.message);
      return res.status(500).json({ error: 'Failed to update the deadline' });
    }

    return res.status(200).json({ success: true, rsvp_cutoff: newCutoff });

  } catch (err) {
    console.error('extend-cutoff error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
