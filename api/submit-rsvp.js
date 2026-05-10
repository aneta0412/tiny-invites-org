import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {

    const {
      party_id,
      guest_name,
      attending,
      guest_count,
      allergies
    } = req.body;

    const { error } = await supabase
      .from('guest_responses')
      .insert([
        {
          party_id,
          guest_name,
          attending,
          guest_count,
          allergies
        }
      ]);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: 'RSVP submitted successfully'
    });

  } catch (err) {

    return res.status(500).json({
      error: err.message
    });

  }
}
