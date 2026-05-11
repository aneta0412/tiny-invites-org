import { createClient } from '@supabase/supabase-js';

console.log("SUPABASE URL EXISTS:", !!process.env.SUPABASE_URL);
console.log("SERVICE ROLE EXISTS:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {

  try {

    const { token } = req.query;

    const { data: party, error: partyError } = await supabase
      .from('parties')
      .select('*')
      .eq('dashboard_token', token)
      .maybeSingle();
      if (!party) {
        return res.status(404).json({
          error: 'Party not found',
          token
      });
      }

    if (partyError) throw partyError;

    const { data: responses, error: responseError } = await supabase
      .from('guest_responses')
      .select('*')
      .eq('party_id', party.party_id);

    if (responseError) throw responseError;

    const yes = responses.filter(
      r => r.attending === 'yes'
    ).length;

    const no = responses.filter(
      r => r.attending === 'no'
    ).length;

    return res.status(200).json({
      party,
      responses,
      stats: {
        yes,
        no,
        pending: 0
      }
    });

  } catch (err) {

    return res.status(500).json({
      error: err.message
    });

  }
}
