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

function welcomeEmailHtml({ child_name, age, venue, dashboard_token, party_id, photo_url, rsvp_url }) {
  const dashUrl = `https://tinyinvites.org/dashboard_page.html?token=${dashboard_token}`;
  const ageStr  = age ? `${ordinal(age)} birthday` : 'party';
  const heroBlock = photo_url
    ? `<tr><td style="padding:0;overflow:hidden;"><img src="${photo_url}" alt="Party" style="width:100%;max-height:220px;object-fit:cover;display:block;border-radius:12px 12px 0 0;"></td></tr>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:16px;">
    <span style="font-family:Georgia,serif;font-size:1.2rem;font-style:italic;color:#c9a84c;">Tiny Invites</span>
  </td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:14px;overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${heroBlock}
      <tr><td style="padding:32px 40px 36px;">
        <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">Your party is live ✦</p>
        <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.3;">${child_name}'s ${ageStr} is all set! 🎉</h1>
        <p style="font-size:0.87rem;color:#6b5c45;line-height:1.7;margin:0 0 18px;">
          Your RSVP page is live. Share the link or QR code below with your guests — you'll get an email each time someone responds.
          ${venue ? `<br><br>📍 <strong style="color:#2a2218;">${venue}</strong>` : ''}
        </p>

        <!-- RSVP link box -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr><td style="background:#f5edda;border:1px solid #e8d5a3;border-radius:10px;padding:14px 18px;">
            <p style="font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:#a89880;margin:0 0 6px;">Your guest RSVP link</p>
            <a href="${rsvp_url}" style="font-size:0.84rem;color:#c9a84c;word-break:break-all;text-decoration:none;">${rsvp_url}</a>
          </td></tr>
        </table>

        <!-- QR code image inline -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr><td align="center" style="background:#f5edda;border:1px solid #e8d5a3;border-radius:10px;padding:16px;">
            <p style="font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:#a89880;margin:0 0 10px;">QR code — save &amp; share</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(rsvp_url)}&color=2a2218&bgcolor=ffffff" 
              alt="QR Code" width="180" height="180" style="display:block;margin:0 auto;border-radius:6px;">
            <p style="font-size:0.68rem;color:#a89880;margin:10px 0 0;">Screenshot or forward this email to share</p>
          </td></tr>
        </table>

        <!-- Dashboard button -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td align="center">
          <a href="${dashUrl}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">View your dashboard</a>
        </td></tr></table>
        <p style="font-size:0.75rem;color:#a89880;margin:18px 0 0;text-align:center;">
          Save this email — your dashboard link is unique to you.
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
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.method === 'GET'
      ? req.query?.token
      : (req.body || {}).token;

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const cleanToken = token.trim();

    // ── Look up party ─────────────────────────────────────
    const { data: party, error: lookupError } = await supabase
      .from('parties')
      .select('*')
      .eq('dashboard_token', cleanToken)
      .single();

    if (lookupError || !party) {
      return res.status(404).json({ error: 'Invalid or expired confirmation link' });
    }

    const rsvpUrl = `https://tinyinvites.org/rsvp.html?party=${party.party_id}`;
    const dashUrl = `/dashboard_page.html?token=${cleanToken}`;

    // ── Already confirmed ─────────────────────────────────
    if (party.confirmed) {
      return res.status(200).json({
        success:    true,
        already:    true,
        party_id:   party.party_id,
        rsvp_url:   rsvpUrl,
        photo_url:  party.photo_url  || null,
        child_name: party.child_name || null,
        dashboard:  dashUrl,
        message:    'Party already confirmed and live',
      });
    }

    // ── Confirm the party ─────────────────────────────────
    const { error: updateError } = await supabase
      .from('parties')
      .update({ confirmed: true, confirmed_at: new Date().toISOString() })
      .eq('dashboard_token', cleanToken);

    if (updateError) {
      console.error('Confirm update error:', updateError.message);
      return res.status(500).json({ error: 'Failed to confirm party' });
    }

    // ── Send welcome email with QR + RSVP link ────────────
    try {
      await resend.emails.send({
        from:    'Tiny Invites <hello@tinyinvites.org>',
        to:      party.parent_email,
        subject: `Your RSVP page for ${party.child_name}'s party is live!`,
        html:    welcomeEmailHtml({
          child_name:      party.child_name,
          age:             party.age,
          venue:           party.venue,
          dashboard_token: cleanToken,
          party_id:        party.party_id,
          photo_url:       party.photo_url || '',
          rsvp_url:        rsvpUrl,
        }),
      });
    } catch (emailErr) {
      console.error('Welcome email failed:', emailErr.message);
    }

    return res.status(200).json({
      success:    true,
      party_id:   party.party_id,
      rsvp_url:   rsvpUrl,
      photo_url:  party.photo_url  || null,
      child_name: party.child_name || null,
      dashboard:  dashUrl,
      message:    'Party confirmed and live',
    });

  } catch (err) {
    console.error('confirm-party error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
