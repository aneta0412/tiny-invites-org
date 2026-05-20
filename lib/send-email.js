// Updated: 2026-05-20
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

const base = inner => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:24px;"><span style="font-family:Georgia,serif;font-size:1.3rem;font-style:italic;color:#c9a84c;">Tiny Invites</span></td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:16px;padding:40px 44px;">${inner}</td></tr>
  <tr><td style="text-align:center;padding:24px 0 0;"><p style="font-size:0.7rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span> · <a href="https://tinyinvites.org" style="color:#a89880;text-decoration:none;">tinyinvites.org</a></p></td></tr>
</table>
</td></tr></table></body></html>`;

const btn = (href, text) =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;"><tr><td align="center">
    <a href="${href}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">${text}</a>
  </td></tr></table>`;


// ── 1. Welcome email to host on party creation ────────────────────────────────
function welcomeEmailHtml({ child_name, age, venue, dashboard_token, party_id }) {
  const dashUrl = `https://tinyinvites.org/dashboard_page.html?token=${dashboard_token}`;
  const rsvpUrl = `https://tinyinvites.org/rsvp.html?party=${party_id}`;
  const ageStr  = age ? `${ordinal(age)} birthday` : 'party';
  return base(`
    <p style="font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;margin:0 0 14px;">Your party is live ✦</p>
    <h1 style="font-family:Georgia,serif;font-size:1.9rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.25;">${child_name}'s ${ageStr}<br>is all set! 🎉</h1>
    <p style="font-size:0.88rem;color:#6b5c45;line-height:1.75;margin:0 0 22px;">
      Your RSVP page is live and your QR code is ready to share. You'll get an email the first time a guest responds each day,
      then a tidy end-of-day summary if there are more. No response that day — no email. 🤫
    </p>
    ${venue ? `<div style="background:#f5edda;border-radius:10px;padding:13px 18px;margin-bottom:22px;font-size:0.84rem;color:#6b5c45;">📍 <strong style="color:#2a2218;">${venue}</strong></div>` : ''}
    ${btn(dashUrl, '📊 View your RSVP dashboard →')}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr><td align="center">
      <a href="${rsvpUrl}" style="display:inline-block;background:transparent;color:#6b5c45;padding:11px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;border:1px solid #e8d5a3;">🔗 Preview RSVP page →</a>
    </td></tr></table>
    <hr style="border:none;border-top:1px solid #f5edda;margin:28px 0 20px;">
    <p style="font-size:0.78rem;color:#a89880;line-height:1.65;margin:0;"><strong style="color:#6b5c45;">Save this email</strong> — your dashboard link is unique to you.</p>
  `);
}


// ── 2. Guest confirmation email ───────────────────────────────────────────────
function guestConfirmationHtml({ party, response }) {
  const attending = response.attending === true || response.attending === 'true' || response.attending === 'yes';
  const ageStr    = party.age ? `${ordinal(party.age)} birthday` : 'party';

  if (!attending) {
    return base(`
      <p style="font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;margin:0 0 14px;">We'll miss you 🥺</p>
      <h1 style="font-family:Georgia,serif;font-size:1.9rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.25;">Thanks for letting us know, ${response.guest_name}</h1>
      <p style="font-size:0.88rem;color:#6b5c45;line-height:1.75;margin:0;">
        That's a shame — but we completely understand. We've let the host know you can't make it to
        <strong>${party.child_name}'s ${ageStr}</strong>. We'll be thinking of you and hope to celebrate together another time. 💛
      </p>
    `);
  }

  return base(`
    <p style="font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;margin:0 0 14px;">You're on the list! 🎉</p>
    <h1 style="font-family:Georgia,serif;font-size:1.9rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.25;">See you there, <em style="color:#c9a84c;">${response.guest_name}!</em></h1>
    <p style="font-size:0.88rem;color:#6b5c45;line-height:1.75;margin:0 0 18px;">
      Your RSVP for <strong>${party.child_name}'s ${ageStr}</strong> is confirmed.
      ${party.venue ? `We'll see you at <strong>${party.venue}</strong>.` : ''}
      Keep an eye on your inbox for any updates from the host. See you there! 🎈
    </p>
    ${response.guest_count > 1 ? `<div style="background:#f5edda;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:0.83rem;color:#6b5c45;">👥 <strong style="color:#2a2218;">${response.guest_count} guests</strong> confirmed under your name</div>` : ''}
    ${response.allergies ? `<div style="background:#fff3e0;border-left:3px solid #c9a84c;border-radius:0 8px 8px 0;padding:12px 16px;font-size:0.82rem;color:#6b5c45;">⚠️ Dietary note recorded: <strong>${response.allergies}</strong></div>` : ''}
  `);
}


// ── 3. Host first-of-day RSVP notification ────────────────────────────────────
function rsvpNotificationHtml({ party, response }) {
  const dashUrl   = `https://tinyinvites.org/dashboard_page.html?token=${party.dashboard_token}`;
  const attending = response.attending === true || response.attending === 'true' || response.attending === 'yes';
  const emoji     = attending ? '🎉' : '🥺';
  const status    = attending ? 'is coming!' : "can't make it";
  return base(`
    <p style="font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;margin:0 0 14px;">New RSVP ${emoji}</p>
    <h1 style="font-family:Georgia,serif;font-size:1.9rem;font-weight:400;color:#2a2218;margin:0 0 18px;line-height:1.25;">${response.guest_name}<br><em style="color:#c9a84c;">${status}</em></h1>
    <div style="background:#f5edda;border-radius:10px;padding:16px 18px;margin-bottom:20px;">
      ${attending && response.guest_count ? `<p style="font-size:0.82rem;color:#6b5c45;margin:0 0 6px;">👥 <strong style="color:#2a2218;">${response.guest_count} guest${response.guest_count > 1 ? 's' : ''}</strong> attending</p>` : ''}
      ${response.allergies ? `<p style="font-size:0.82rem;color:#6b5c45;margin:0;">⚠️ <strong>Dietary / note:</strong> ${response.allergies}</p>` : `<p style="font-size:0.82rem;color:#a89880;margin:0;">No dietary requirements noted.</p>`}
    </div>
    <p style="font-size:0.78rem;color:#a89880;margin:0 0 4px;">Any further responses today will be bundled into a single end-of-day summary.</p>
    ${btn(dashUrl, '📊 See full guest list →')}
  `);
}


// ── 4. Daily digest / full guest-list email ───────────────────────────────────
function digestEmailHtml({ party, responses }) {
  const dashUrl = `https://tinyinvites.org/dashboard_page.html?token=${party.dashboard_token}`;
  const yes     = responses.filter(r => r.attending === true || r.attending === 'true' || r.attending === 'yes');
  const no      = responses.filter(r => !yes.includes(r));
  const total   = responses.length;

  // Catering totals (for the host to plan food / cake / party bags)
  const sum = key => yes.reduce((s, r) => s + (parseInt(r[key]) || 0), 0);
  const adults   = sum('guest_count_adults');
  const children = sum('guest_count_children');
  const babies   = sum('guest_count_babies');
  const headcount = adults + children + babies;

  // Per-guest rows include a breakdown column ("2 adults · 1 child")
  const rows = responses.map(r => {
    const att = r.attending === true || r.attending === 'true' || r.attending === 'yes';
    const a = parseInt(r.guest_count_adults)   || 0;
    const c = parseInt(r.guest_count_children) || 0;
    const b = parseInt(r.guest_count_babies)   || 0;
    const parts = [];
    if (a) parts.push(`${a} adult${a!==1?'s':''}`);
    if (c) parts.push(`${c} ${c===1?'child':'children'}`);
    if (b) parts.push(`${b} ${b===1?'baby':'babies'}`);
    const breakdown = parts.length ? parts.join(' · ') : '—';
    return `<tr>
      <td style="padding:9px 12px;font-size:0.82rem;color:#2a2218;border-bottom:1px solid #f5edda;">${r.guest_name}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f5edda;"><span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:0.7rem;background:${att?'#eaf2ec':'#f5f0e8'};color:${att?'#5a8a6a':'#a0907e'};">${att?'✓ Coming':'✗ Declined'}</span></td>
      <td style="padding:9px 12px;font-size:0.78rem;color:#6b5c45;border-bottom:1px solid #f5edda;text-align:center;">${r.guest_count||'—'}</td>
      <td style="padding:9px 12px;font-size:0.74rem;color:#6b5c45;border-bottom:1px solid #f5edda;">${breakdown}</td>
      <td style="padding:9px 12px;font-size:0.78rem;color:#6b5c45;border-bottom:1px solid #f5edda;">${r.allergies||'—'}</td>
    </tr>`;
  }).join('');

  const cateringRow = headcount > 0 ? `
    <p style="font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;color:#a89880;margin:24px 0 8px;">🍽️ Catering breakdown</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr>
        <td width="33%" style="padding-right:4px;"><div style="background:#f5edda;border-radius:10px;padding:14px 8px;text-align:center;border:1px solid #e8d5a3;"><div style="font-family:Georgia,serif;font-size:1.7rem;color:#c9a84c;line-height:1;">${adults}</div><div style="font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:#6b5c45;margin-top:6px;">Adults</div></div></td>
        <td width="33%" style="padding:0 2px;"><div style="background:#f5edda;border-radius:10px;padding:14px 8px;text-align:center;border:1px solid #e8d5a3;"><div style="font-family:Georgia,serif;font-size:1.7rem;color:#c9a84c;line-height:1;">${children}</div><div style="font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:#6b5c45;margin-top:6px;">Children</div><div style="font-size:0.58rem;color:#a89880;font-style:italic;">age 1+</div></div></td>
        <td width="33%" style="padding-left:4px;"><div style="background:#f5edda;border-radius:10px;padding:14px 8px;text-align:center;border:1px solid #e8d5a3;"><div style="font-family:Georgia,serif;font-size:1.7rem;color:#c9a84c;line-height:1;">${babies}</div><div style="font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:#6b5c45;margin-top:6px;">Babies</div><div style="font-size:0.58rem;color:#a89880;font-style:italic;">under 1</div></div></td>
      </tr>
    </table>
    <p style="text-align:center;font-size:0.78rem;color:#6b5c45;margin:0 0 22px;"><strong style="color:#2a2218;">${headcount}</strong> people for catering</p>
  ` : '';

  return base(`
    <p style="font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;margin:0 0 14px;">Guest list 📋</p>
    <h1 style="font-family:Georgia,serif;font-size:1.9rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.25;">${total} response${total!==1?'s':''} so far<br>for <em style="color:#c9a84c;">${party.child_name}'s party</em></h1>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr>
        <td width="50%" style="padding-right:6px;"><div style="background:#eaf2ec;border-radius:10px;padding:14px;text-align:center;"><div style="font-family:Georgia,serif;font-size:1.8rem;color:#5a8a6a;">${yes.length}</div><div style="font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#5a8a6a;">Confirmed</div></div></td>
        <td width="50%" style="padding-left:6px;"><div style="background:#f5f0e8;border-radius:10px;padding:14px;text-align:center;"><div style="font-family:Georgia,serif;font-size:1.8rem;color:#a0907e;">${no.length}</div><div style="font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a0907e;">Declined</div></div></td>
      </tr>
    </table>
    ${cateringRow}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f5edda;border-radius:10px;overflow:hidden;margin-bottom:24px;">
      <thead><tr style="background:#f5edda;">
        <th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:left;font-weight:500;">Name</th>
        <th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:left;font-weight:500;">Status</th>
        <th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:center;font-weight:500;">Total</th>
        <th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:left;font-weight:500;">Breakdown</th>
        <th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:left;font-weight:500;">Dietary</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${btn(dashUrl, '📊 View full dashboard →')}
  `);
}


export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const { data: party, error: partyErr } = await supabase
      .from('parties').select('*').eq('dashboard_token', token).single();

    if (partyErr || !party) return res.status(404).json({ error: 'Party not found' });
    if (!party.parent_email) return res.status(400).json({ error: 'No email on file' });

    const { data: responses, error: respErr } = await supabase
      .from('guest_responses').select('*')
      .eq('party_id', party.party_id)
      .order('created_at', { ascending: false });

    if (respErr) throw respErr;

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
    console.error('send-email error:', err);
    return res.status(500).json({ error: err.message });
  }
}
