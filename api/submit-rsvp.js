import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail({ to, subject, html }) {
  return resend.emails.send({
    from: 'Tiny Invites <onboarding@resend.dev>',
    to,
    subject,
    html,
  });
}

const ordinal = n => { const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };

const base = (inner, photoUrl = '') => {
  const heroBlock = photoUrl ? `
    <tr><td style="padding:0;overflow:hidden;">
      <img src="${photoUrl}" alt="Party" style="width:100%;max-height:200px;object-fit:cover;display:block;border-radius:12px 12px 0 0;">
    </td></tr>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:16px;"><span style="font-family:Georgia,serif;font-size:1.2rem;font-style:italic;color:#c9a84c;">Tiny Invites</span></td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:14px;overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${heroBlock}
      <tr><td style="padding:32px 40px 36px;">${inner}</td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;padding:20px 0 0;"><p style="font-size:0.68rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span> · <a href="https://tinyinvites.org" style="color:#a89880;text-decoration:none;">tinyinvites.org</a></p></td></tr>
</table>
</td></tr></table></body></html>`;
};

const btn = (href, text) =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td align="center">
    <a href="${href}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">${text}</a>
  </td></tr></table>`;

function guestConfirmationHtml({ party, response }) {
  const attending = response.attending === true || response.attending === 'true' || response.attending === 'yes';
  const ageStr    = party.age ? `${ordinal(party.age)} birthday` : 'party';
  if (!attending) {
    return base(`
      <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">We'll miss you 🥺</p>
      <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.3;">Thanks for letting us know, ${response.guest_name}</h1>
      <p style="font-size:0.87rem;color:#6b5c45;line-height:1.7;margin:0;">
        We've let the host know you can't make it to <strong>${party.child_name}'s ${ageStr}</strong>. We hope to celebrate together another time. 💛
      </p>
    `, party.photo_url || '');
  }
  return base(`
    <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">You're on the list! 🎉</p>
    <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.3;">See you there, ${response.guest_name}!</h1>
    <p style="font-size:0.87rem;color:#6b5c45;line-height:1.7;margin:0 0 16px;">
      Your RSVP for <strong>${party.child_name}'s ${ageStr}</strong> is confirmed.${party.venue ? ` We'll see you at <strong>${party.venue}</strong>.` : ''} 🎈
    </p>
    ${response.guest_count > 1 ? `<p style="font-size:0.82rem;color:#6b5c45;margin:0 0 10px;">👥 <strong>${response.guest_count} guests</strong> confirmed under your name</p>` : ''}
    ${response.allergies ? `<p style="font-size:0.82rem;color:#6b5c45;background:#fff3e0;border-left:3px solid #c9a84c;padding:10px 14px;border-radius:0 6px 6px 0;margin:0;">⚠️ Dietary note recorded: <strong>${response.allergies}</strong></p>` : ''}
  `, party.photo_url || '');
}

function rsvpNotificationHtml({ party, response }) {
  const dashUrl   = `https://tinyinvites.org/dashboard_page.html?token=${party.dashboard_token}`;
  const attending = response.attending === true || response.attending === 'true' || response.attending === 'yes';
  const emoji     = attending ? '🎉' : '🥺';
  const status    = attending ? 'is coming!' : "can't make it";
  return base(`
    <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">New RSVP ${emoji}</p>
    <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 16px;line-height:1.3;">${response.guest_name} ${status}</h1>
    ${attending && response.guest_count ? `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 8px;">👥 <strong>${response.guest_count} guest${response.guest_count > 1 ? 's' : ''}</strong> attending</p>` : ''}
    ${response.allergies ? `<p style="font-size:0.85rem;color:#6b5c45;background:#fff3e0;border-left:3px solid #c9a84c;padding:10px 14px;border-radius:0 6px 6px 0;margin:0 0 12px;">⚠️ Dietary note: <strong>${response.allergies}</strong></p>` : ''}
    <p style="font-size:0.78rem;color:#a89880;margin:12px 0 0;">Any further responses today will be bundled into a daily summary.</p>
    ${btn(dashUrl, '📊 See full guest list →')}
  `, party.photo_url || '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { party_id, guest_name, attending, guest_count, allergies, guest_email } = req.body;

    if (!party_id)   return res.status(400).json({ error: 'Missing party_id' });
    if (!guest_name) return res.status(400).json({ error: 'Missing guest_name' });

    const { error } = await supabase
      .from('guest_responses')
      .insert([{ party_id, guest_name, attending, guest_count, allergies,
                  guest_email: guest_email || null }]);

    if (error) throw error;

    ;(async () => {
      try {
        const { data: party } = await supabase
          .from('parties').select('*').eq('party_id', party_id).single();
        if (!party) return;

        const response = { guest_name, attending, guest_count, allergies, guest_email };

        if (guest_email) {
          sendEmail({
            to:      guest_email,
            subject: attending === true || attending === 'true'
              ? `You're confirmed for ${party.child_name}'s party! 🎉`
              : `Thanks for letting us know 💛`,
            html: guestConfirmationHtml({ party, response }),
          }).catch(e => console.error('Guest email failed:', e.message));
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: todayRows } = await supabase
          .from('guest_responses')
          .select('id')
          .eq('party_id', party_id)
          .gte('created_at', todayStart.toISOString());

        if (todayRows && todayRows.length === 1) {
          sendEmail({
            to:      party.parent_email,
            subject: attending === true || attending === 'true'
              ? `🎉 ${guest_name} is coming to ${party.child_name}'s party!`
              : `${guest_name} can't make it to ${party.child_name}'s party`,
            html: rsvpNotificationHtml({ party, response }),
          }).catch(e => console.error('Host notification failed:', e.message));
        }

      } catch (e) {
        console.error('Email background error:', e.message);
      }
    })();

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('submit-rsvp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
