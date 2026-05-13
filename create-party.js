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
      child_name,
      age,
      venue,
      party_date,
      parent_email,
      theme,
      photo_url
    } = req.body;

    const party_id = crypto.randomUUID();
    const dashboard_token = crypto.randomUUID();

    const { error } = await supabase
      .from('parties')
      .insert([
        {
          party_id,
          dashboard_token,
          child_name,
          age,
          venue,
          party_date,
          parent_email,
          theme,
          photo_url: photo_url || null
        }
      ]);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      party_id,
      dashboard_token,
      rsvp_link: `/rsvp.html?party=${party_id}`,
      dashboard_link: `/dashboard.html?token=${dashboard_token}`
    });

  } catch (err) {

    return res.status(500).json({
      error: err.message
    });

  }
}
