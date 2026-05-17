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

function welcomeEmailHtml({ child_name, age, venue, dashboard_token, party_id }) {
  const dashUrl = `https://tinyinvites.org/dashboard_page.html?token=${dashboard_token}`;
  const rsvpUrl = `https://tinyinvites.org/rsvp.html?party=${party_id}`;
  const ageStr  = age ? `${ordinal(age)} birthday` : 'party';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:24px;"><span style="font-family:Georgia,serif;font-size:1.3rem;font-style:italic;color:#c9a84c;">Tiny Invites</span></td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:16px;padding:40px 44px;">
    <p style="font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;margin:0 0 14px;">Your party is live ✦</p>
    <h1 style="font-family:Georgia,serif;font-size:1.9rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.25;">${child_name}'s ${ageStr}<br>is all set! 🎉</h1>
    <p style="font-size:0.88rem;color:#6b5c45;line-height:1.75;margin:0 0 22px;">
      Your RSVP page is live and your QR code is ready to share. You'll get an email the moment a guest responds.
    </p>
    ${venue ? `<div style="background:#f5edda;border-radius:10px;padding:13px 18px;margin-bottom:22px;font-size:0.84rem;color:#6b5c45;">📍 <strong style="color:#2a2218;">${venue}</strong></div>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;"><tr><td align="center">
      <a href="${dashUrl}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">📊 View your dashboard →</a>
    </td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr><td align="center">
      <a href="${rsvpUrl}" style="display:inline-block;background:transparent;color:#6b5c45;padding:11px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;border:1px solid #e8d5a3;">🔗 Preview RSVP page →</a>
    </td></tr></table>
    <hr style="border:none;border-top:1px solid #f5edda;margin:28px 0 20px;">
    <p style="font-size:0.78rem;color:#a89880;line-height:1.65;margin:0;"><strong style="color:#6b5c45;">Save this email</strong> — your dashboard link is unique to you.</p>
  </td></tr>
  <tr><td style="text-align:center;padding:24px 0 0;">
    <p style="font-size:0.7rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span> · <a href="https://tinyinvites.org" style="color:#a89880;text-decoration:none;">tinyinvites.org</a></p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { party_id, dashboard_token, parent_email, phone_number } = req.body;

    if (!party_id)        return res.status(400).json({ error: 'Missing party_id' });
    if (!dashboard_token) return res.status(400).json({ error: 'Missing dashboard_token' });
    if (!parent_email)    return res.status(400).json({ error: 'Missing parent_email' });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parent_email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Verify the token matches this party (security check)
    const { data: party, error: fetchErr } = await supabase
      .from('parties')
      .select('*')
      .eq('party_id', party_id)
      .eq('dashboard_token', dashboard_token)
      .single();

    if (fetchErr || !party) {
      return res.status(404).json({ error: 'Party not found or token mismatch' });
    }

    // Update party with email, phone, and mark as published
    const { error: updateErr } = await supabase
      .from('parties')
      .update({
        parent_email: parent_email,
        phone_number: phone_number || null,
        published_at: new Date().toISOString(),
      })
      .eq('party_id', party_id);

    if (updateErr) throw updateErr;

    // Send welcome email — fire and forget
    resend.emails.send({
      from:    'Tiny Invites <onboarding@resend.dev>',
      to:      parent_email,
      subject: `Your RSVP page for ${party.child_name}'s party is live! 🎉`,
      html:    welcomeEmailHtml({
        child_name:      party.child_name,
        age:             party.age,
        venue:           party.venue,
        dashboard_token: dashboard_token,
        party_id:        party_id,
      }),
    }).catch(err => console.error('Welcome email failed:', err.message));

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('publish-party error:', err);
    return res.status(500).json({ error: err.message });
  }
}
