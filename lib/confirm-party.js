// Updated: 2026-06-10
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { hostFooter } from './send-email.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

// Escape host-supplied text before placing it in email HTML.
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function formatPartyDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch (e) { return iso; }
}

function welcomeEmailHtml({ child_name, age, venue, party_date, dashboard_token, party_id, photo_url, rsvp_url, rsvp_cutoff_days }) {
  const pageUrl = `https://tinyinvites.org/dashboard_page.html?token=${dashboard_token}`;
  const ageStr     = age ? `${ordinal(age)} birthday` : 'party';
  const cutoffDays = rsvp_cutoff_days || 7;
  const heroBlock = photo_url
    ? `<tr><td style="padding:0;overflow:hidden;"><img src="${photo_url}" alt="Party" style="width:100%;max-height:220px;object-fit:cover;display:block;border-radius:12px 12px 0 0;"></td></tr>`
    : '';
  const dateLine = party_date
    ? `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 14px;"><strong style="color:#2a2218;">${formatPartyDate(party_date)}</strong></p>`
    : '';

  // ── Numbered step helper ────────────────────────────────
  const step = (num, text) => `
    <tr><td style="padding:0 0 12px 0;">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="width:28px;vertical-align:top;padding-top:2px;">
          <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:#f5edda;color:#c9a84c;font-size:0.68rem;font-weight:600;text-align:center;line-height:22px;">${num}</span>
        </td>
        <td style="font-size:0.82rem;color:#6b5c45;line-height:1.6;padding-left:8px;">${text}</td>
      </tr></table>
    </td></tr>`;

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
        <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.3;">${esc(child_name)}'s ${ageStr} is live!</h1>
        <p style="font-size:0.87rem;color:#6b5c45;line-height:1.7;margin:0 0 20px;">
          Your RSVP page is live. Share the link below with your guests and you'll get an email each time someone responds.
        </p>
        ${dateLine}
        ${venue ? `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 18px;"><strong style="color:#2a2218;">${esc(venue)}</strong></p>` : ''}

        <!-- RSVP link -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr><td style="background:#f5edda;border:1px solid #e8d5a3;border-radius:10px;padding:14px 18px;">
            <p style="font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:#a89880;margin:0 0 6px;">Your guest RSVP link</p>
            <a href="${rsvp_url}" style="font-size:0.84rem;color:#c9a84c;word-break:break-all;text-decoration:none;">${rsvp_url}</a>
          </td></tr>
        </table>

        <!-- QR code -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr><td align="center" style="background:#f5edda;border:1px solid #e8d5a3;border-radius:10px;padding:16px;">
            <p style="font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:#a89880;margin:0 0 10px;">QR code — save &amp; share</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(rsvp_url)}&color=2a2218&bgcolor=ffffff"
              alt="QR Code" width="180" height="180" style="display:block;margin:0 auto;border-radius:6px;">
            <p style="font-size:0.72rem;color:#6b5c45;margin:12px 0 0;line-height:1.5;text-align:left;">
              The link above is the most reliable way to share — it works perfectly every time. If you'd like to print the QR code, keep it at least the size of a large postage stamp and place it on a plain background for best results.
            </p>
          </td></tr>
        </table>

        <!-- Host page labeled block -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr><td style="background:#f5edda;border:1px solid #e8d5a3;border-radius:10px;padding:14px 18px;">
            <p style="font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:#a89880;margin:0 0 6px;">Your Party Page — manage &amp; view all RSVPs</p>
            <a href="${pageUrl}" style="font-size:0.84rem;color:#c9a84c;word-break:break-all;text-decoration:none;">${pageUrl}</a>
            <p style="font-size:0.72rem;color:#a89880;margin:8px 0 0;line-height:1.5;">This link is private to you. Save it — you'll use it to track responses and message guests.</p>
          </td></tr>
        </table>

        <!-- CTA button -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td align="center">
          <a href="${pageUrl}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">Open your Party Page</a>
        </td></tr></table>

        <!-- What happens next -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
          <tr><td style="padding-bottom:14px;">
            <p style="font-size:0.6rem;letter-spacing:0.14em;text-transform:uppercase;color:#c9a84c;margin:0 0 2px;">What happens next</p>
            <hr style="border:none;border-top:1px solid #f5edda;margin:0;">
          </td></tr>
          ${step(1, '<strong>Share your invite</strong> — send the link or QR code via WhatsApp, text, email, or on printed cards.')}
          ${step(2, '<strong>Responses arrive automatically</strong> — every RSVP lands in your inbox and on your Party Page. If more than 15 responses come in, they\'ll be grouped into a daily summary sent after 8pm so your inbox stays tidy.')}
          ${step(3, '<strong>Have a play</strong> — try the invite yourself. You can edit or remove any response from your Party Page and it disappears from the system.')}
          ${step(4, `<strong>Automatic cutoff</strong> — responses will close automatically <strong>${cutoffDays} days before the party</strong>, as you selected. This setting can't be changed once invitations have been sent.`)}
          ${step(5, '<strong>Guests get a reminder</strong> — we automatically email all confirmed guests 3 days before the party. Tip: add a note to your Party Page (e.g. parking details, what to bring) and it\'ll be included in the reminder — no need to send a separate message.')}
          ${step(6, '<strong>Message your guests</strong> — need to share an update? You can message all confirmed guests from your Party Page at any time.')}
          ${step(7, '<strong>Emergency contact</strong> — if you urgently need to reach guests, you can export the full guest list with email addresses from your Party Page.')}
          ${step(8, "<strong>Photo and date are locked</strong> — once live, these can't be changed. If you need to update them, delete the party and create a new one.")}
        </table>

        <p style="font-size:0.78rem;color:#a89880;margin:24px 0 0;text-align:center;line-height:1.5;">
          Save this email — your Party Page link is unique to you.
        </p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;padding:20px 0 0;">
    <p style="font-size:0.68rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span></p>
  </td></tr>
  ${hostFooter(dashboard_token)}
</table>
</td></tr></table></body></html>`;
}

export default async function handler(req, res) {
  // POST only. GET is deliberately rejected: email link scanners
  // (Outlook/Gmail) pre-fetch GET URLs, which would confirm the party
  // before the host ever opened the email. confirm.html POSTs the token.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = (req.body || {}).token;

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

    // ── Derive cutoff days from party data ────────────────
    let rsvpCutoffDays = 7; // default
    if (party.rsvp_cutoff && party.party_date) {
      try {
        const cutoff = new Date(party.rsvp_cutoff);
        const pDate  = new Date(party.party_date);
        const diff   = Math.round((pDate - cutoff) / (1000 * 60 * 60 * 24));
        if (diff > 0) rsvpCutoffDays = diff;
      } catch (_) {}
    }
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
        dashboard:        dashUrl,
        rsvp_cutoff_days: rsvpCutoffDays,
        message:          'Party already confirmed and live',
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
        subject: `${party.child_name}'s RSVP page is live — here's everything you need`,
        html:    welcomeEmailHtml({
          child_name:      party.child_name,
          age:             party.age,
          venue:           party.venue,
          party_date:      party.party_date,
          dashboard_token: cleanToken,
          party_id:        party.party_id,
          photo_url:        party.photo_url || '',
          rsvp_url:         rsvpUrl,
          rsvp_cutoff_days: rsvpCutoffDays,
        }),
      });
    } catch (emailErr) {
      console.error('Welcome email failed:', emailErr.message);
    }

    // ── Admin notification ────────────────────────────────
    try {
      await resend.emails.send({
        from:    'Tiny Invites <hello@tinyinvites.org>',
        to:      'hello@tinyinvites.org',
        subject: `✅ Party confirmed — ${party.child_name}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#2a2218;line-height:1.8;">
          <strong>Party confirmed and live</strong><br/><br/>
          👶 <strong>Child:</strong> ${esc(party.child_name)}${party.age ? `, turning ${ordinal(party.age)}` : ''}<br/>
          📅 <strong>Date:</strong> ${formatPartyDate(party.party_date)}<br/>
          📍 <strong>Venue:</strong> ${party.venue ? esc(party.venue) : '—'}<br/>
          ✉️ <strong>Host:</strong> ${party.parent_email}<br/>
          🔗 <strong>RSVP URL:</strong> <a href="${rsvpUrl}">${rsvpUrl}</a><br/>
          🔑 <strong>Party ID:</strong> ${party.party_id}<br/>
          🕓 <strong>Confirmed at:</strong> ${new Date().toUTCString()}
        </p>`,
      });
    } catch (adminErr) {
      console.error('Admin notification failed:', adminErr.message);
    }

    return res.status(200).json({
      success:    true,
      party_id:   party.party_id,
      rsvp_url:   rsvpUrl,
      photo_url:  party.photo_url  || null,
      child_name: party.child_name || null,
      dashboard:        dashUrl,
      rsvp_cutoff_days: rsvpCutoffDays,
      message:          'Party confirmed and live',
    });

  } catch (err) {
    console.error('confirm-party error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
