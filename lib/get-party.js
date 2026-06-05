// Updated: 2026-06-05
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Columns safe to expose publicly to guests.
// Deliberately excludes dashboard_token and parent_email.
const PUBLIC_COLUMNS = [
  'party_id',
  'child_name',
  'age',
  'venue',
  'party_date',
  'theme',
  'photo_url',
  'special_note',
  'phone_number',
  'count_adults',
  'count_babies',
  'rsvp_cutoff',
].join(', ');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing party id' });
  }

  // Basic UUID format check — prevents junk queries hitting Supabase
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid party id format' });
  }

  try {
    const { data, error } = await supabase
      .from('parties')
      .select(PUBLIC_COLUMNS)
      .eq('party_id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Party not found', code: 'PARTY_NOT_FOUND' });
    }

    // If the party date has passed, tell the guest gracefully
    if (data.party_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(data.party_date) < today) {
        return res.status(410).json({
          error: 'This party has already taken place',
          code:  'PARTY_PAST',
          child_name: data.child_name || null,
        });
      }
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('get-party error:', err);
    return res.status(500).json({ error: err.message });
  }
}
