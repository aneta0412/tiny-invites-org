import { createClient } from '@supabase/supabase-js';
import { sendEmail, digestEmailHtml } from './send-email.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }

    // Look up party by dashboard token
    const { data: party, error: partyErr } = await supabase
      .from('parties')
      .select('*')
      .eq('dashboard_token', token)
      .single();

    if (partyErr || !party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    if (!party.parent_email) {
      return res.status(400).json({ error: 'No email address on file for this party' });
    }

    // Fetch all responses
    const { data: responses, error: respErr } = await supabase
      .from('guest_responses')
      .select('*')
      .eq('party_id', party.party_id)
      .order('created_at', { ascending: false });

    if (respErr) throw respErr;

    // Normalise attending boolean → 'yes'/'no'
    const normalised = (responses || []).map(r => ({
      ...r,
      attending: r.attending === true || r.attending === 'true' ? 'yes' : 'no'
    }));

    await sendEmail({
      to:      party.parent_email,
      subject: `📋 Guest list for ${party.child_name}'s party`,
      html:    digestEmailHtml({ party, responses: normalised }),
    });

    return res.status(200).json({ success: true, sent_to: party.parent_email });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
