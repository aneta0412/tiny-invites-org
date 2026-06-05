// Updated: 2026-06-04
// lib/send-email.js
//
// Centralised email helpers. Anything sent to the HOST should include a
// "delete your party" footer via hostFooter(); guest-facing emails should not.
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Exports used by other modules (e.g. daily-digest) ────────────────────────
export async function sendEmail({ to, subject, html }) {
  return resend.emails.send({
    from: 'Tiny Invites <hello@tinyinvites.org>',
    to,
    subject,
    html,
  });
}

export const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

// Escape guest-/host-supplied text before placing it in email HTML.
export const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// Pretty-print a YYYY-MM-DD (or any parseable date) for emails.
// Returns '' for null/undefined/unparseable input.
export function formatPartyDate(val) {
  if (!val) return '';
  try {
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return ''; }
}

// ── Host-only footer ─────────────────────────────────────────────────────────
// Renders the "change your mind, you can delete your party here" footer.
// Only call this for emails sent to the host (party creator), never to guests.
export function hostFooter(dashboard_token) {
  if (!dashboard_token) return '';
  const deleteUrl = `https://tinyinvites.org/delete-party.html?token=${dashboard_token}`;
  return `
    <tr><td style="text-align:center;padding:14px 0 0;">
      <p style="font-size:0.72rem;color:#a89880;margin:0;line-height:1.6;">
        Change your mind?
        <a href="${deleteUrl}" style="color:#a89880;text-decoration:underline;">You can delete your party here.</a>
      </p>
    </td></tr>`;
}

// ── Layout ───────────────────────────────────────────────────────────────────
// `opts.deleteToken` — if provided, adds the host footer block.
export const base = (inner, opts = {}) => {
  const footerBlock = opts.deleteToken ? hostFooter(opts.deleteToken) : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#faf6ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:24px;"><span style="font-family:Georgia,serif;font-size:1.3rem;font-style:italic;color:#c9a84c;">Tiny Invites</span></td></tr>
  <tr><td style="background:#fff9f2;border:1px solid #f5edda;border-radius:16px;padding:40px 44px;">${inner}</td></tr>
  <tr><td style="text-align:center;padding:24px 0 0;"><p style="font-size:0.7rem;color:#a89880;margin:0;">Sent by <span style="color:#c9a84c;">Tiny Invites</span> · <a href="https://tinyinvites.org" style="color:#a89880;text-decoration:none;">tinyinvites.org</a></p></td></tr>
  ${footerBlock}
</table>
</td></tr></table></body></html>`;
};

export const btn = (href, text) =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;"><tr><td align="center">
    <a href="${href}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">${text}</a>
  </td></tr></table>`;


// ── Daily digest / full guest-list email ──────────────────────────────────────
// NOTE: the welcome, guest-confirmation, and host-notification templates live
// with the flows that actually send them (confirm-party.js, submit-rsvp.js) to
// avoid duplicate copies drifting out of sync. This module owns the digest only.
// `opts.includeEmails` — when true, adds a Contact (email) column to the table.
// Used by the dashboard "Email me full guest list with contacts" button. The
// scheduled daily digest leaves it false so routine emails stay contact-free.
export function digestEmailHtml({ party, responses }, opts = {}) {
  const includeEmails = opts.includeEmails === true;
  const dashUrl = `https://tinyinvites.org/dashboard_page.html?token=${party.dashboard_token}`;
  const yes     = responses.filter(r => r.attending === true || r.attending === 'true' || r.attending === 'yes');
  const no      = responses.filter(r => !yes.includes(r));
  const total   = responses.length;

  // Honour host's counting preferences: children always shown; adults and
  // babies only shown if the host enabled them when setting up the party.
  const showAdults = party.count_adults === true || party.count_adults === 'true';
  const showBabies = party.count_babies === true || party.count_babies === 'true';

  // Catering totals (for the host to plan food / cake / party bags)
  const sum = key => yes.reduce((s, r) => s + (parseInt(r[key]) || 0), 0);
  const adults   = showAdults ? sum('guest_count_adults') : 0;
  const children = sum('guest_count_children');
  const babies   = showBabies ? sum('guest_count_babies') : 0;
  const headcount = adults + children + babies;

  // Per-guest rows include a breakdown column ("2 adults · 1 child")
  const rows = responses.map(r => {
    const att = r.attending === true || r.attending === 'true' || r.attending === 'yes';
    const a = showAdults ? (parseInt(r.guest_count_adults)   || 0) : 0;
    const c = parseInt(r.guest_count_children) || 0;
    const b = showBabies ? (parseInt(r.guest_count_babies)   || 0) : 0;
    const parts = [];
    if (a) parts.push(`${a} adult${a!==1?'s':''}`);
    if (c) parts.push(`${c} ${c===1?'child':'children'}`);
    if (b) parts.push(`${b} ${b===1?'baby':'babies'}`);
    const breakdown = parts.length ? parts.join(' · ') : '—';
    const breakdownCell = (showAdults || showBabies)
      ? `<td style="padding:9px 12px;font-size:0.74rem;color:#6b5c45;border-bottom:1px solid #f5edda;">${breakdown}</td>`
      : '';
    const emailCell = includeEmails
      ? `<td style="padding:9px 12px;font-size:0.74rem;color:#6b5c45;border-bottom:1px solid #f5edda;">${r.guest_email ? `<a href="mailto:${encodeURIComponent(r.guest_email)}" style="color:#c9a84c;text-decoration:none;">${esc(r.guest_email)}</a>` : '—'}</td>`
      : '';
    return `<tr>
      <td style="padding:9px 12px;font-size:0.82rem;color:#2a2218;border-bottom:1px solid #f5edda;">${esc(r.guest_name)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f5edda;"><span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:0.7rem;background:${att?'#eaf2ec':'#f5f0e8'};color:${att?'#5a8a6a':'#a0907e'};">${att?'✓ Coming':'✗ Declined'}</span></td>
      <td style="padding:9px 12px;font-size:0.78rem;color:#6b5c45;border-bottom:1px solid #f5edda;text-align:center;">${r.guest_count||'—'}</td>
      ${breakdownCell}
      <td style="padding:9px 12px;font-size:0.78rem;color:#6b5c45;border-bottom:1px solid #f5edda;">${r.allergies ? esc(r.allergies) : '—'}</td>
      ${emailCell}
    </tr>`;
  }).join('');

  const breakdownHeader = (showAdults || showBabies)
    ? `<th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:left;font-weight:500;">Breakdown</th>`
    : '';

  const emailHeader = includeEmails
    ? `<th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:left;font-weight:500;">Contact</th>`
    : '';

  // Build only the catering tiles the host opted into. Children always shown.
  const cateringTiles = [];
  if (showAdults) cateringTiles.push({ value: adults,   label: 'Adults',   sub: '' });
  cateringTiles.push({ value: children, label: 'Children', sub: showBabies ? 'age 1+' : '' });
  if (showBabies) cateringTiles.push({ value: babies,   label: 'Babies',   sub: 'under 1' });
  const tileWidth = Math.floor(100 / cateringTiles.length);

  const cateringRow = headcount > 0 ? `
    <p style="font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;color:#a89880;margin:24px 0 8px;">Guest summary</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr>${cateringTiles.map((tile, i) => `
        <td width="${tileWidth}%" style="padding:0 ${i === 0 ? 0 : 2}px 0 ${i === cateringTiles.length - 1 ? 0 : 2}px;">
          <div style="background:#f5edda;border-radius:10px;padding:14px 8px;text-align:center;border:1px solid #e8d5a3;">
            <div style="font-family:Georgia,serif;font-size:1.7rem;color:#c9a84c;line-height:1;">${tile.value}</div>
            <div style="font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:#6b5c45;margin-top:6px;">${tile.label}</div>
            ${tile.sub ? `<div style="font-size:0.58rem;color:#a89880;font-style:italic;">${tile.sub}</div>` : ''}
          </div>
        </td>`).join('')}
      </tr>
    </table>
    <p style="text-align:center;font-size:0.78rem;color:#6b5c45;margin:0 0 22px;"><strong style="color:#2a2218;">${headcount}</strong> guests</p>
  ` : '';

  const partyDateLine = party.party_date
    ? `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 18px;">📅 <strong style="color:#2a2218;">${formatPartyDate(party.party_date)}</strong></p>`
    : '';

  // Privacy reminder shown only when contact emails are included.
  const contactNote = includeEmails ? `
    <p style="font-size:0.74rem;color:#a89880;line-height:1.6;margin:0 0 22px;padding:12px 14px;background:#f5edda;border-radius:8px;">
      🔒 This list includes your guests' email addresses because you requested it.
      Please use them only to contact guests about this party, and keep them private.
    </p>` : '';

  return base(`
    <p style="font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#c9a84c;margin:0 0 14px;">Guest list 📋</p>
    <h1 style="font-family:Georgia,serif;font-size:1.9rem;font-weight:400;color:#2a2218;margin:0 0 10px;line-height:1.25;">${total} response${total!==1?'s':''} so far<br>for <em style="color:#c9a84c;">${esc(party.child_name)}'s party</em></h1>
    ${partyDateLine}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr>
        <td width="50%" style="padding-right:6px;"><div style="background:#eaf2ec;border-radius:10px;padding:14px;text-align:center;"><div style="font-family:Georgia,serif;font-size:1.8rem;color:#5a8a6a;">${yes.length}</div><div style="font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#5a8a6a;">Confirmed</div></div></td>
        <td width="50%" style="padding-left:6px;"><div style="background:#f5f0e8;border-radius:10px;padding:14px;text-align:center;"><div style="font-family:Georgia,serif;font-size:1.8rem;color:#a0907e;">${no.length}</div><div style="font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a0907e;">Declined</div></div></td>
      </tr>
    </table>
    ${cateringRow}
    ${contactNote}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f5edda;border-radius:10px;overflow:hidden;margin-bottom:24px;">
      <thead><tr style="background:#f5edda;">
        <th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:left;font-weight:500;">Name</th>
        <th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:left;font-weight:500;">Status</th>
        <th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:center;font-weight:500;">Total</th>
        ${breakdownHeader}
        <th style="padding:9px 12px;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:#a89880;text-align:left;font-weight:500;">Dietary</th>
        ${emailHeader}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${btn(dashUrl, '📊 View full dashboard →')}
  `, { deleteToken: party.dashboard_token });
}


// ── Default handler — sends the "email me the full guest list" digest ────────
export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, include_emails } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const includeEmails = include_emails === true || include_emails === 'true';

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
      subject: includeEmails
        ? `📋 Guest list with contacts for ${party.child_name}'s party`
        : `📋 Guest list for ${party.child_name}'s party`,
      html:    digestEmailHtml({ party, responses: normalised }, { includeEmails }),
    });

    return res.status(200).json({ success: true, sent_to: party.parent_email });

  } catch (err) {
    console.error('send-email error:', err);
    return res.status(500).json({ error: err.message });
  }
}
