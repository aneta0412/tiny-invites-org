import { createClient } from '@supabase/supabase-js';
import { sendEmail, rsvpNotificationHtml, guestConfirmationHtml } from './send-email.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {

    const { party_id, guest_name, attending, guest_count, allergies, guest_email } = req.body;

    if (!party_id)   return res.status(400).json({ error: 'Missing party_id' });
    if (!guest_name) return res.status(400).json({ error: 'Missing guest_name' });

    // ── Save RSVP ──────────────────────────────────────────────────────────────
    const { error } = await supabase
      .from('guest_responses')
      .insert([{ party_id, guest_name, attending, guest_count, allergies,
                 guest_email: guest_email || null }]);

    if (error) throw error;

    // ── Emails — fire and forget, never block the response ────────────────────
    ;(async () => {
      try {
        const { data: party } = await supabase
          .from('parties').select('*').eq('party_id', party_id).single();
        if (!party) return;

        const response = { guest_name, attending, guest_count, allergies, guest_email };

        // 1. Guest confirmation (only if they gave their email)
        if (guest_email) {
          sendEmail({
            to:      guest_email,
            subject: attending === true || attending === 'true'
              ? `You're confirmed for ${party.child_name}'s party! 🎉`
              : `Thanks for letting us know 💛`,
            html: guestConfirmationHtml({ party, response }),
          }).catch(e => console.error('Guest email failed:', e.message));
        }

        // 2. Host — only send immediately if this is the FIRST response today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: todayRows } = await supabase
          .from('guest_responses')
          .select('id')
          .eq('party_id', party_id)
          .gte('created_at', todayStart.toISOString());

        // If exactly 1 row today (the one we just saved) → first of day, send now
        if (todayRows && todayRows.length === 1) {
          sendEmail({
            to:      party.parent_email,
            subject: attending === true || attending === 'true'
              ? `🎉 ${guest_name} is coming to ${party.child_name}'s party!`
              : `${guest_name} can't make it to ${party.child_name}'s party`,
            html: rsvpNotificationHtml({ party, response }),
          }).catch(e => console.error('Host notification failed:', e.message));
        }
        // If >1 today, the digest cron job will handle it at end of day

      } catch (e) {
        console.error('Email background task failed:', e.message);
      }
    })();

    return res.status(200).json({ success: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
