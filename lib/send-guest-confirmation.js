// Updated: 2026-06-14 — premium, compact email redesign
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Escape guest-/host-supplied text before placing it in email HTML.
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── Date helpers ──────────────────────────────────────────────────────────
// NOTE: adjust the field list below to match your `parties` table column.
const resolvePartyDate = party => {
  const raw = party.party_date || party.date || party.event_date || party.party_datetime;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d) ? null : d;
};

const fmtPartyDate = d => {
  const opts = { timeZone: 'Europe/London' };
  const date = d.toLocaleDateString('en-GB',
    { ...opts, weekday: 'long', day: 'numeric', month: 'long' });
  const hasTime = d.getHours() || d.getMinutes();
  if (!hasTime) return date;
  const time = d.toLocaleTimeString('en-GB',
    { ...opts, hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(':00', '');
  return `${date} · ${time}`;
};

const gcalLink = (party, d) => {
  if (!d) return null;
  const pad = x => x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(d.getTime() + 2 * 60 * 60 * 1000); // assume ~2h
  const title = `${party.child_name}'s ${party.age ? ordinal(party.age) + ' birthday' : 'party'}`;
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${pad(d)}/${pad(end)}`,
    location: party.venue || '',
    details: 'RSVP confirmed via Tiny Invites',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
};

// ── Shell ─────────────────────────────────────────────────────────────────
const base = inner => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f1e6;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f1e6;padding:40px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="text-align:center;padding-bottom:22px;">
    <span style="font-family:Georgia,'Times New Roman',serif;font-size:1.25rem;font-style:italic;color:#c9a84c;letter-spacing:0.01em;">Tiny&nbsp;Invites</span>
  </td></tr>
  <tr><td style="background:#fffaf3;border:1px solid #efe2cb;border-top:3px solid #c9a84c;border-radius:18px;padding:40px 42px 36px;">
    ${inner}
  </td></tr>
  <tr><td style="text-align:center;padding:22px 0 0;">
    <p style="font-size:0.68rem;color:#a89880;margin:0;line-height:1.6;">
      Sent with care by <span style="color:#c9a84c;">Tiny Invites</span><br>
      <a href="https://tinyinvites.org" style="color:#a89880;text-decoration:none;">tinyinvites.org</a>
    </p>
  </td></tr>
</table>
</td></tr></table></body></html>`;

// Gold medallion — the one bold element. `glyph` is an HTML entity.
const medallion = (glyph, gold = '#c9a84c', ring = '#f1e6cb') => `
  <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 22px;">
    <tr><td style="padding:6px;background:${ring};border-radius:50%;">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="width:58px;height:58px;background:${gold};border-radius:50%;text-align:center;vertical-align:middle;color:#fffaf0;font-size:26px;line-height:58px;font-family:Arial,sans-serif;">${glyph}</td>
      </tr></table>
    </td></tr>
  </table>`;

const eyebrow = txt => `<p style="text-align:center;font-size:0.62rem;letter-spacing:0.24em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">${txt}</p>`;

const headline = html => `<h1 style="text-align:center;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:1.78rem;color:#2a2218;margin:0 0 14px;line-height:1.28;">${html}</h1>`;

const lede = html => `<p style="text-align:center;font-size:0.9rem;color:#6b5c45;line-height:1.7;margin:0 auto;max-width:380px;">${html}</p>`;

// Single tidy details panel — replaces the scattered coloured badges.
const detailsPanel = rows => {
  const body = rows.filter(Boolean).map((r, i, a) => {
    const border = i < a.length - 1 ? 'border-bottom:1px solid #f0e7d4;' : '';
    return `<tr>
      <td style="padding:12px 0;${border}font-size:0.64rem;letter-spacing:0.14em;text-transform:uppercase;color:#b6a079;white-space:nowrap;">${r[0]}</td>
      <td style="padding:12px 0;${border}text-align:right;font-size:0.88rem;color:#2a2218;">${r[1]}</td>
    </tr>`;
  }).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0"
    style="margin:24px 0 0;background:#faf4e8;border:1px solid #f0e7d4;border-radius:12px;padding:4px 20px;">
    ${body}</table>`;
};

// ── Content ───────────────────────────────────────────────────────────────
function guestConfirmationHtml({ party, response }) {
  const attending = response.attending === true
    || response.attending === 'true'
    || response.attending === 'yes';

  const ageStr = party.age ? `${ordinal(party.age)} birthday` : 'party';
  const partyDate = resolvePartyDate(party);

  // ── Can't make it ──
  if (!attending) {
    return base(`
      ${medallion('&#10084;', '#cbb887', '#f0e8d6')}
      ${eyebrow('RSVP noted')}
      ${headline(`Thanks for letting us know, ${esc(response.guest_name)}`)}
      ${lede(`We're sorry you can't join <strong>${esc(party.child_name)}'s ${ageStr}</strong> —
        we've passed your reply to the host. We hope to celebrate together another time.`)}
      ${party.parent_email
        ? `<p style="text-align:center;font-size:0.78rem;color:#a89880;margin:24px 0 0;line-height:1.6;">
             Changed your mind? Get in touch with the host at
             <a href="mailto:${esc(party.parent_email)}" style="color:#c9a84c;text-decoration:none;">${esc(party.parent_email)}</a>.
           </p>`
        : ''}
    `);
  }

  // ── Attending ──
  const rows = [
    partyDate ? ['When', esc(fmtPartyDate(partyDate))] : null,
    party.venue ? ['Where', esc(party.venue)] : null,
    response.guest_count > 1 ? ['Party', `${response.guest_count} guests in your name`] : null,
    response.allergies ? ['Dietary note', esc(response.allergies)] : null,
  ];

  const cal = gcalLink(party, partyDate);
  const giftUrl = party.gift_url
    || `https://tinyinvites.org/gifts${party.age ? `?age=${party.age}` : ''}`;
  const finderUrl = party.finder_url || 'https://tinyinvites.org/partyfinder.html';

  return base(`
    ${medallion('&#10003;')}
    ${eyebrow('RSVP confirmed')}
    ${headline(`See you there, <em style="color:#c9a84c;font-style:normal;">${esc(response.guest_name)}</em>`)}
    ${lede(`You're on the list for <strong>${esc(party.child_name)}'s ${ageStr}</strong>.
      We'll send a gentle reminder closer to the day — nothing else to do for now.`)}
    ${rows.some(Boolean) ? detailsPanel(rows) : ''}
    ${cal
      ? `<p style="text-align:center;margin:22px 0 0;">
           <a href="${cal}" style="display:inline-block;font-size:0.8rem;letter-spacing:0.04em;color:#8a6d2f;text-decoration:none;border:1px solid #e3d3a8;border-radius:999px;padding:10px 22px;">
             Add to calendar
           </a>
         </p>`
      : ''}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0;">
      <tr><td style="border-top:1px solid #f0e7d4;padding-top:24px;text-align:center;">
        <p style="font-size:0.62rem;letter-spacing:0.24em;text-transform:uppercase;color:#c9a84c;margin:0 0 10px;">Gift ideas</p>
        <p style="font-size:0.86rem;color:#6b5c45;line-height:1.65;margin:0 auto 16px;max-width:340px;">
          Looking for the perfect present? We've rounded up a few favourites${party.age ? ` for a ${ordinal(party.age)} birthday` : ''}.
        </p>
        <a href="${giftUrl}" style="display:inline-block;font-size:0.8rem;letter-spacing:0.04em;color:#fffaf0;background:#c9a84c;text-decoration:none;border-radius:999px;padding:11px 26px;">Browse gift ideas</a>
        <p style="font-size:0.64rem;color:#b6a079;line-height:1.6;margin:14px auto 0;max-width:340px;">
          Linked products are selected and curated by Tiny Invites. We may earn a commission if you buy from here.
        </p>
      </td></tr>
    </table>
    ${party.parent_email
      ? `<p style="text-align:center;font-size:0.74rem;color:#a89880;margin:22px 0 0;line-height:1.6;">
           Questions for the host? <a href="mailto:${esc(party.parent_email)}" style="color:#c9a84c;text-decoration:none;">${esc(party.parent_email)}</a>
         </p>`
      : ''}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
      <tr><td style="border-top:1px solid #f0e7d4;padding-top:22px;text-align:center;">
        <p style="font-size:0.84rem;color:#6b5c45;line-height:1.6;margin:0;">
          Planning a party of your own?
          <a href="${finderUrl}" style="color:#c9a84c;text-decoration:none;font-weight:bold;white-space:nowrap;">Find the perfect venue&nbsp;&rarr;</a>
        </p>
      </td></tr>
    </table>
  `);
}

// ── Handler (unchanged logic) ───────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { party_id, response_id, guest_email } = req.body;

    if (!party_id)    return res.status(400).json({ error: 'Missing party_id' });
    if (!guest_email) return res.status(400).json({ error: 'Missing guest_email' });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email)) {
      return res.status(400).json({ error: 'Invalid guest_email' });
    }

    const { data: party, error: partyErr } = await supabase
      .from('parties').select('*').eq('party_id', party_id).single();

    if (partyErr || !party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    let response;
    if (response_id) {
      const { data, error } = await supabase
        .from('guest_responses').select('*').eq('id', response_id).single();
      if (error || !data) return res.status(404).json({ error: 'Response not found' });
      response = data;
    } else {
      const { data, error } = await supabase
        .from('guest_responses').select('*')
        .eq('party_id', party_id).eq('guest_email', guest_email)
        .order('created_at', { ascending: false }).limit(1).single();
      if (error || !data) return res.status(404).json({ error: 'Response not found' });
      response = data;
    }

    const attending = response.attending === true
      || response.attending === 'true'
      || response.attending === 'yes';

    const subject = attending
      ? `You're confirmed for ${party.child_name}'s party`
      : `Thanks for letting us know — ${party.child_name}'s party`;

    // Fire and forget — RSVP is already saved; email failure must not affect response.
    resend.emails.send({
      from:    'Tiny Invites <hello@tinyinvites.org>',
      to:      guest_email,
      subject,
      html:    guestConfirmationHtml({ party, response }),
    }).catch(err => console.error('Guest confirmation email failed:', err.message));

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('send-guest-confirmation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
