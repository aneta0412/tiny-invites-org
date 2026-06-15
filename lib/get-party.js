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
  'party_time',
  'party_duration_min',
  'theme',
  'photo_url',
  'special_note',
  'count_adults',
  'count_babies',
  'rsvp_cutoff',
  'phone_number',
].join(', ');

// Today's calendar date in Europe/London as "YYYY-MM-DD", for timezone-stable
// comparison against UK party dates.
function londonTodayISO() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing party id' });
  }

  // Basic UUID format check — prevents junk queries hitting Supabase
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid party id format' });
  }

  try {
    const { data, error } = await supabase
      .from('parties')
      .select(PUBLIC_COLUMNS)
      .eq('party_id', id)
      .eq('confirmed', true)   // unconfirmed parties are not public
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Party not found', code: 'PARTY_NOT_FOUND' });
    }

    // If the party date has passed, tell the guest gracefully.
    // Compare as Europe/London date strings — party_date is a UK calendar date,
    // so anchoring "today" to London avoids UTC off-by-one near midnight / BST.
    if (data.party_date) {
      if (String(data.party_date).slice(0, 10) < londonTodayISO()) {
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
    return res.status(500).json({ error: 'Internal server error' });
  }
}
