import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ── After this many RSVPs, switch from individual emails to digest ──
const INDIVIDUAL_NOTIFICATION_LIMIT = 15;

async function sendEmail({ to, subject, html }) {
  return resend.emails.send({
    from: 'Tiny Invites <hello@tinyinvites.org>',
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

function rsvpNotificationHtml({ party, response, totalCount }) {
  const dashUrl   = `https://tinyinvites.org/dashboard_page.html?token=${party.dashboard_token}`;
  const attending = response.attending === true || response.attending === 'true' || response.attending === 'yes';
  const emoji     = attending ? '🎉' : '🥺';
  const status    = attending ? 'is coming!' : "can't make it";

  // Show a digest hint once they're getting close to the limit
  const nearLimit  = totalCount >= INDIVIDUAL_NOTIFICATION_LIMIT - 2;
  const atLimit    = totalCount >= INDIVIDUAL_NOTIFICATION_LIMIT;
  const digestNote = atLimit
    ? `<p style="font-size:0.78rem;color:#a89880;margin:12px 0 0;">You've received ${INDIVIDUAL_NOTIFICATION_LIMIT} individual notifications — further replies today will be bundled into a digest summary.</p>`
    : nearLimit
    ? `<p style="font-size:0.78rem;color:#a89880;margin:12px 0 0;">You have ${INDIVIDUAL_NOTIFICATION_LIMIT - totalCount} individual notification${INDIVIDUAL_NOTIFICATION_LIMIT - totalCount === 1 ? '' : 's'} remaining — after that, further replies will be bundled into a digest.</p>`
    : '';

  return base(`
    <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">New RSVP ${emoji}</p>
    <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 16px;line-height:1.3;">${response.guest_name} ${status}</h1>
    ${attending && response.guest_count ? `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 8px;">👥 <strong>${response.guest_count} guest${response.guest_count > 1 ? 's' : ''}</strong> attending</p>` : ''}
    ${response.allergies ? `<p style="font-size:0.85rem;color:#6b5c45;background:#fff3e0;border-left:3px solid #c9a84c;padding:10px 14px;border-radius:0 6px 6px 0;margin:0 0 12px;">⚠️ Dietary note: <strong>${response.allergies}</strong></p>` : ''}
    ${digestNote}
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

    // ── 1. Save the RSVP ─────────────────────────────────
    const { data: insertData, error: insertError } = await supabase
      .from('guest_responses')
      .insert([{ party_id, guest_name, attending, guest_count, allergies,
                  guest_email: guest_email || null }])
      .select('id')
      .single();

    if (insertError) throw insertError;

    const responseId = insertData?.id;

    // ── 2. Look up the party ──────────────────────────────
    const { data: party, error: partyError } = await supabase
      .from('parties')
      .select('*')
      .eq('party_id', party_id)
      .single();

    if (partyError) console.error('Party lookup error:', partyError.message);

    if (!party) {
      console.error('Party not found for party_id:', party_id);
      return res.status(200).json({ success: true, id: responseId });
    }

    const response = { guest_name, attending, guest_count, allergies, guest_email };

    // ── 3. Count total all-time RSVPs for this party ──────
    // This is the running total — first 15 get individual emails, rest go to digest
    const { count: totalCount } = await supabase
      .from('guest_responses')
      .select('id', { count: 'exact', head: true })
      .eq('party_id', party_id);

    const sendIndividual = totalCount <= INDIVIDUAL_NOTIFICATION_LIMIT;

    // ── 4. Send emails in parallel, awaited before responding ──
    const emailPromises = [];

    if (sendIndividual) {
      // Individual notification — sent for the first 15 RSVPs
      emailPromises.push(
        sendEmail({
          to:      party.parent_email,
          subject: attending === true || attending === 'true'
            ? `🎉 ${guest_name} is coming to ${party.child_name}'s party!`
            : `${guest_name} can't make it to ${party.child_name}'s party`,
          html: rsvpNotificationHtml({ party, response, totalCount }),
        }).catch(e => console.error('Host notification failed:', e.message))
      );
    }
    // NOTE: digest summary emails (for RSVPs beyond 15) should be handled
    // by a scheduled job (e.g. Vercel cron or Supabase pg_cron) that queries
    // all un-notified RSVPs and sends a single batched summary email per party.

    if (guest_email) {
      emailPromises.push(
        sendEmail({
          to:      guest_email,
          subject: attending === true || attending === 'true'
            ? `You're confirmed for ${party.child_name}'s party! 🎉`
            : `Thanks for letting us know 💛`,
          html: guestConfirmationHtml({ party, response }),
        }).catch(e => console.error('Guest email failed:', e.message))
      );
    }

    await Promise.all(emailPromises);

    // ── 5. Respond only after everything is done ──────────
    return res.status(200).json({ success: true, id: responseId });

  } catch (err) {
    console.error('submit-rsvp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
