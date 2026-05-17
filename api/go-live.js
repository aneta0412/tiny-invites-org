import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

function welcomeEmailHtml({ child_name, age, venue, dashboard_token, party_id, photo_url }) {
  const dashUrl = `https://tinyinvites.org/dashboard_page.html?token=${dashboard_token}`;
  const rsvpUrl = `https://tinyinvites.org/rsvp.html?party=${party_id}`;
  const ageStr  = age ? `${ordinal(age)} birthday` : 'party';
  const heroBlock = photo_url
    ? `<tr><td style="padding:0;overflow:hidden;"><img src="${photo_url}" alt="Party" style="width:100%;max-height:200px;object-fit:cover;display:block;border-radius:12px 12px 0 0;"></td></tr>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:16px;"><span style="font-family:Georgia,serif;font-size:1.2rem;font-style:italic;color:#c9a84c;">Tiny Invites</span></td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:14px;overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${heroBlock}
      <tr><td style="padding:32px 40px 36px;">
        <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">Your party is live ✦</p>
        <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.3;">${child_name}'s ${ageStr} is all set! 🎉</h1>
        <p style="font-size:0.87rem;color:#6b5c45;line-height:1.7;margin:0 0 18px;">
          Your RSVP page is live. Share the link or QR code and you will get an email each time a guest responds.
          ${venue ? `<br><br>📍 <strong style="color:#2a2218;">${venue}</strong>` : ''}
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td align="center">
          <a href="${dashUrl}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">View your dashboard</a>
        </td></tr></table>
        <p style="font-size:0.75rem;color:#a89880;margin:18px 0 0;text-align:center;">
          <a href="${rsvpUrl}" style="color:#a89880;text-decoration:underline;">Preview RSVP page</a>
          - Save this email, your dashboard link is unique to you.
        </p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;padding:20px 0 0;">
    <p style="font-size:0.68rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span></p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { child_name, age, venue, parent_email, photo_url, special_note, phone_number } = req.body;

    if (!child_name)   return res.status(400).json({ error: 'Missing child_name' });
    if (!parent_email) return res.status(400).json({ error: 'Missing parent_email' });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parent_email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const party_id        = randomUUID();
    const dashboard_token = randomUUID();

    const insertPayload = {
      party_id,
      dashboard_token,
      child_name,
      age:          age          || null,
      venue:        venue        || null,
      parent_email,
      photo_url:    photo_url    || null,
      special_note: special_note || null,
      phone_number: phone_number || null,
    };

    const { error } = await supabase
      .from('parties')
      .insert([insertPayload]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    resend.emails.send({
      from:    'Tiny Invites <onboarding@resend.dev>',
      to:      parent_email,
      subject: `Your RSVP page for ${child_name}'s party is live!`,
      html:    welcomeEmailHtml({ child_name, age, venue, dashboard_token, party_id, photo_url: photo_url || '' }),
    }).catch(err => console.error('Welcome email failed:', err.message));

    return res.status(200).json({
      success:        true,
      party_id,
      dashboard_token,
      rsvp_link:      `/rsvp.html?party=${party_id}`,
      dashboard_link: `/dashboard_page.html?token=${dashboard_token}`,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
