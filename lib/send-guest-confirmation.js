// Updated: 2026-05-20
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

const base = inner => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:24px;">
    <span style="font-family:Georgia,serif;font-size:1.3rem;font-style:italic;color:#c9a84c;">Tiny Invites</span>
  </td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:16px;padding:40px 44px;">
    ${inner}
  </td></tr>
  <tr><td style="text-align:center;padding:24px 0 0;">
    <p style="font-size:0.7rem;color:#a89880;margin:0;">
      Sent by <span style="color:#c9a84c;">Tiny Invites</span> ·
      <a href="https://tinyinvites.org" style="color:#a89880;text-decoration:none;">tinyinvites.org</a>
    </p>
  </td></tr>
</table>
</td></tr></table></body></html>`;

function guestConfirmationHtml({ party, response }) {
  const attending = response.attending === true
    || response.attending === 'true'
    || response.attending === 'yes';

  const ageStr = party.age ? `${ordinal(party.age)} birthday` : 'party';

  if (!attending) {
    return base(`
      <p style="font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;margin:0 0 14px;">We'll miss you 🥺</p>
      <h1 style="font-family:Georgia,serif;font-size:1.9rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.25;">
        Thanks for letting us know, ${response.guest_name}
      </h1>
      <p style="font-size:0.88rem;color:#6b5c45;line-height:1.75;margin:0;">
        That's a shame — but we completely understand. We've let the host know
        you can't make it to <strong>${party.child_name}'s ${ageStr}</strong>.
        We'll be thinking of you and hope to celebrate together another time. 💛
      </p>
    `);
  }

  return base(`
    <p style="font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;margin:0 0 14px;">You're on the list! 🎉</p>
    <h1 style="font-family:Georgia,serif;font-size:1.9rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.25;">
      See you there, <em style="color:#c9a84c;">${response.guest_name}!</em>
    </h1>
    <p style="font-size:0.88rem;color:#6b5c45;line-height:1.75;margin:0 0 18px;">
      Your RSVP for <strong>${party.child_name}'s ${ageStr}</strong> is confirmed.
      ${party.venue
        ? `We'll see you at <strong>${party.venue}</strong>.`
        : ''}
      Keep an eye on your inbox for any updates from the host. See you there! 🎈
    </p>
    ${response.guest_count > 1
      ? `<div style="background:#f5edda;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:0.83rem;color:#6b5c45;">
           👥 <strong style="color:#2a2218;">${response.guest_count} guests</strong> confirmed under your name
         </div>`
      : ''}
    ${response.allergies
      ? `<div style="background:#fff3e0;border-left:3px solid #c9a84c;border-radius:0 8px 8px 0;padding:12px 16px;font-size:0.82rem;color:#6b5c45;">
           ⚠️ Dietary note recorded: <strong>${response.allergies}</strong>
         </div>`
      : ''}
    ${party.parent_email
      ? `<p style="font-size:0.78rem;color:#a89880;margin:20px 0 0;line-height:1.65;">
           Questions? Reach the host at
           <a href="mailto:${party.parent_email}" style="color:#c9a84c;text-decoration:none;">
             ${party.parent_email}
           </a>
         </p>`
      : ''}
  `);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { party_id, response_id, guest_email } = req.body;

    if (!party_id)    return res.status(400).json({ error: 'Missing party_id' });
    if (!guest_email) return res.status(400).json({ error: 'Missing guest_email' });

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email)) {
      return res.status(400).json({ error: 'Invalid guest_email' });
    }

    // Fetch party
    const { data: party, error: partyErr } = await supabase
      .from('parties')
      .select('*')
      .eq('party_id', party_id)
      .single();

    if (partyErr || !party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    // Fetch the RSVP response — by response_id if provided, else most recent for this party+email
    let response;
    if (response_id) {
      const { data, error } = await supabase
        .from('guest_responses')
        .select('*')
        .eq('id', response_id)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Response not found' });
      response = data;
    } else {
      // Fallback: most recent response for this party with this email
      const { data, error } = await supabase
        .from('guest_responses')
        .select('*')
        .eq('party_id', party_id)
        .eq('guest_email', guest_email)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Response not found' });
      response = data;
    }

    const attending = response.attending === true
      || response.attending === 'true'
      || response.attending === 'yes';

    const subject = attending
      ? `You're confirmed for ${party.child_name}'s party! 🎉`
      : `We'll miss you at ${party.child_name}'s party 💛`;

    // Fire and forget — RSVP is already saved, email failure must not affect response
    resend.emails.send({
      from:    'Tiny Invites <onboarding@resend.dev>',
      to:      guest_email,
      subject,
      html:    guestConfirmationHtml({ party, response }),
    }).catch(err => console.error('Guest confirmation email failed:', err.message));

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('send-guest-confirmation error:', err);
    return res.status(500).json({ error: err.message });
  }
}
