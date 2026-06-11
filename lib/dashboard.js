// Updated: 2026-05-20
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {

    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const { data: party, error: partyError } = await supabase
      .from('parties')
      .select('*')
      .eq('dashboard_token', token)
      .single();

    if (partyError || !party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    const { data: responses, error: responseError } = await supabase
      .from('guest_responses')
      .select('*')
      .eq('party_id', party.party_id)
      .order('created_at', { ascending: false });

    if (responseError) throw responseError;

    // Normalise boolean attending → 'yes'/'no' strings for dashboard HTML
    const normalised = (responses || []).map(r => ({
      ...r,
      attending: r.attending === true || r.attending === 'true' || r.attending === 'yes' ? 'yes' : 'no'
    }));

    const yes = normalised.filter(r => r.attending === 'yes').length;
    const no  = normalised.filter(r => r.attending === 'no').length;

    return res.status(200).json({
      party,
      responses: normalised,
      stats: { yes, no, pending: 0 }
    });

  } catch (err) {
    console.error('[dashboard] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
