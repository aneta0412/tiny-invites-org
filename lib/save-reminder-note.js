// lib/save-reminder-note.js
// Writes (or clears) the reminder_note field on the parties row.
// Called by dashboard-api?action=save-reminder-note
// POST body: { token, reminder_note }

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_NOTE = 500;

export default async function saveReminderNote(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, reminder_note } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  const note = (reminder_note || '').trim();

  if (note.length > MAX_NOTE) {
    return res.status(400).json({ error: `Note exceeds ${MAX_NOTE} characters` });
  }

  // Resolve token → party
  const { data: party, error: partyError } = await supabase
    .from('parties')
    .select('party_id')
    .eq('dashboard_token', token)
    .single();

  if (partyError || !party) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  // Write (null when empty so cron skips the block cleanly)
  const { error: updateError } = await supabase
    .from('parties')
    .update({ reminder_note: note || null })
    .eq('party_id', party.party_id);

  if (updateError) {
    console.error('[save-reminder-note]', updateError.message);
    return res.status(500).json({ error: 'Failed to save note' });
  }

  return res.status(200).json({ ok: true, reminder_note: note || null });
}
