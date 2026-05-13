import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {

  const checks = {
    SUPABASE_URL:             !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY:           !!process.env.RESEND_API_KEY,
  };

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Try reading from parties table
    const { data, error } = await supabase
      .from('parties')
      .select('party_id, child_name, created_at')
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      return res.status(200).json({
        env: checks,
        supabase: 'CONNECTED but query failed',
        error: error.message,
      });
    }

    return res.status(200).json({
      env: checks,
      supabase: 'OK',
      recent_parties: data,
    });

  } catch (err) {
    return res.status(200).json({
      env: checks,
      supabase: 'FAILED',
      error: err.message,
    });
  }
}
