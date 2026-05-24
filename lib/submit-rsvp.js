// Updated: 2026-05-23
import { createClient }     from '@supabase/supabase-js';
import { Resend }           from 'resend';
import { hostFooter }       from './send-email.js';
import { enforceRateLimit } from './rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const INDIVIDUAL_NOTIFICATION_LIMIT = 15;

// ── Validation helpers ─────────────────────────────────────────
function sanitiseString(val, maxLen = 200) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function isValidEmail(str) {
  return typeof str === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
}

function isValidAttending(val) {
  return [true, false, 'true', 'false', 'yes', 'no'].includes(val);
}

function normaliseAttending(val) {
  return val === true || val === 'true' || val === 'yes';
}

function isValidCount(val, required = false) {
  if (val === null || val === undefined) return !required;
  const n = Number(val);
  return Number.isInteger(n) && n >= 0 && n <= 30;
}

// ── Email helpers ──────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  return resend.emails.send({
    from: 'Tiny Invites <hello@tinyinvites.org>',
    to,
    subject,
    html,
  });
}

const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

// base() builds the email shell. Pass `deleteToken` to add the "delete your
// party" footer — only do that for emails going to the host.
const base = (inner, photoUrl = '', deleteToken = null) => {
  const heroBlock = photoUrl ? `
    <tr><td style="padding:0;overflow:hidden;">
      <img src="${photoUrl}" alt="Party" style="width:100%;max-height:200px;object-fit:cover;display:block;border-radius:12px 12px 0 0;">
    </td></tr>` : '';
  const footerBlock = deleteToken ? hostFooter(deleteToken) : '';
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
  ${footerBlock}
</table>
</td></tr></table></body></html>`;
};

const btnHtml = (href, text) =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td align="center">
    <a href="${href}" style="display:inline-block;background:#2a2218;color:#faf6ef;padding:13px 28px;border-radius:8px;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">${text}</a>
  </td></tr></table>`;

function buildGuestBreakdown(response) {
  const parts = [];
  if (response.guest_count_children > 0)
    parts.push(`${response.guest_count_children} ${response.guest_count_children === 1 ? 'child' : 'children'}`);
  if (response.guest_count_babies > 0)
    parts.push(`${response.guest_count_babies} ${response.guest_count_babies === 1 ? 'baby' : 'babies'}`);
  if (response.guest_count_adults > 0)
    parts.push(`${response.guest_count_adults} ${response.guest_count_adults === 1 ? 'adult' : 'adults'}`);
  return parts.length ? parts.join(' · ') : null;
}

// Guest-facing — NO host footer.
function guestConfirmationHtml({ party, response }) {
  const attending = normaliseAttending(response.attending);
  const ageStr    = party.age ? `${ordinal(party.age)} birthday` : 'party';
  const breakdown = buildGuestBreakdown(response);
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
    ${breakdown ? `<p style="font-size:0.82rem;color:#6b5c45;margin:0 0 10px;">👥 <strong>${breakdown}</strong> confirmed under your name</p>` : ''}
    ${response.allergies ? `<p style="font-size:0.82rem;color:#6b5c45;background:#fff3e0;border-left:3px solid #c9a84c;padding:10px 14px;border-radius:0 6px 6px 0;margin:0;">⚠️ Dietary note recorded: <strong>${response.allergies}</strong></p>` : ''}
  `, party.photo_url || '');
}

// Host-facing — includes the host footer.
function rsvpNotificationHtml({ party, response, todayCount }) {
  const dashUrl   = `https://tinyinvites.org/dashboard_page.html?token=${party.dashboard_token}`;
  const attending = normaliseAttending(response.attending);
  const emoji     = attending ? '🎉' : '🥺';
  const status    = attending ? 'is coming!' : "can't make it";
  const breakdown = buildGuestBreakdown(response);
  const nearLimit = todayCount >= INDIVIDUAL_NOTIFICATION_LIMIT - 2;
  const atLimit   = todayCount >= INDIVIDUAL_NOTIFICATION_LIMIT;
  const digestNote = atLimit
    ? `<p style="font-size:0.78rem;color:#a89880;margin:12px 0 0;">You've received ${INDIVIDUAL_NOTIFICATION_LIMIT} individual notifications today — any further replies today will arrive in your 8pm digest.</p>`
    : nearLimit
    ? `<p style="font-size:0.78rem;color:#a89880;margin:12px 0 0;">${INDIVIDUAL_NOTIFICATION_LIMIT - todayCount} more individual notification${INDIVIDUAL_NOTIFICATION_LIMIT - todayCount === 1 ? '' : 's'} today — after that, replies will be bundled into your 8pm digest.</p>`
    : '';
  return base(`
    <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">New RSVP ${emoji}</p>
    <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 16px;line-height:1.3;">${response.guest_name} ${status}</h1>
    ${attending && breakdown ? `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 8px;">👥 ${breakdown}</p>` : ''}
    ${response.allergies ? `<p style="font-size:0.85rem;color:#6b5c45;background:#fff3e0;border-left:3px solid #c9a84c;padding:10px 14px;border-radius:0 6px 6px 0;margin:0 0 12px;">${attending ? '⚠️ Dietary note' : '💬 Message from guest'}: <strong>${response.allergies}</strong></p>` : ''}
    ${digestNote}
    ${btnHtml(dashUrl, '📊 See full guest list →')}
  `, party.photo_url || '', party.dashboard_token);
}

// ── Handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Rate limit (TC12) ─────────────────────────────────────
  // First, a per-IP envelope: 30 RSVP attempts per IP per 10 min. This catches
  // bots hammering the endpoint from a single source.
  if (await enforceRateLimit(req, res, {
    name:   'submit-rsvp:ip',
    limit:  30,
    window: '10 m',
  })) return;

  try {
    const body = req.body || {};

    // ── Required fields ──────────────────────────────────────
    const party_id   = sanitiseString(body.party_id, 36);
    const guest_name = sanitiseString(body.guest_name, 100);

    if (!party_id)   return res.status(400).json({ error: 'Missing party_id' });
    if (!guest_name) return res.status(400).json({ error: 'Missing or empty guest_name' });
    if (!/^[0-9a-f-]{36}$/.test(party_id)) return res.status(400).json({ error: 'Invalid party_id format' });

    // ── Optional fields ──────────────────────────────────────
    const attending             = body.attending !== undefined ? body.attending : null;
    const guest_count           = body.guest_count          !== undefined ? Number(body.guest_count)          : 1;
    const guest_count_children  = body.guest_count_children !== undefined ? Number(body.guest_count_children) : 0;
    const guest_count_babies    = body.guest_count_babies   !== undefined ? Number(body.guest_count_babies)   : null;
    const guest_count_adults    = body.guest_count_adults   !== undefined ? Number(body.guest_count_adults)   : null;
    const allergies             = sanitiseString(body.allergies, 300);
    const guest_email           = body.guest_email ? body.guest_email.toString().trim().toLowerCase() : null;

    if (attending !== null && !isValidAttending(attending))
      return res.status(400).json({ error: 'Invalid attending value' });
    if (!isValidCount(guest_count, true))
      return res.status(400).json({ error: 'Invalid guest_count' });
    if (!isValidCount(guest_count_children))
      return res.status(400).json({ error: 'Invalid guest_count_children' });
    if (!isValidCount(guest_count_babies))
      return res.status(400).json({ error: 'Invalid guest_count_babies' });
    if (!isValidCount(guest_count_adults))
      return res.status(400).json({ error: 'Invalid guest_count_adults' });
    if (guest_email && !isValidEmail(guest_email))
      return res.status(400).json({ error: 'Invalid guest email address' });

    // ── Rate limit per party (anti-stuffing) ─────────────────
    // 60 RSVPs per party per 10 min from a single IP. A real venue capacity
    // would rarely produce a real burst over this — but a bot stuffing a
    // single party's guest list absolutely will.
    if (await enforceRateLimit(req, res, {
      name:   'submit-rsvp:party',
      limit:  60,
      window: '10 m',
      key:    party_id,
    })) return;

    // ── 1. Verify party exists and is confirmed ───────────────
    const { data: party, error: partyError } = await supabase
      .from('parties')
      .select('*')
      .eq('party_id', party_id)
      .single();

    if (partyError || !party) return res.status(404).json({ error: 'Party not found' });
    if (!party.confirmed)     return res.status(403).json({ error: 'This party is not yet live' });

    // ── 2. Duplicate check ────────────────────────────────────
    const { data: existing } = await supabase
      .from('guest_responses')
      .select('id')
      .eq('party_id', party_id)
      .ilike('guest_name', guest_name)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({ success: true, duplicate: true, id: existing.id });
    }

    // ── 3. Save the RSVP ─────────────────────────────────────
    const { data: insertData, error: insertError } = await supabase
      .from('guest_responses')
      .insert([{
        party_id,
        guest_name,
        attending,
        guest_count,
        guest_count_children,
        guest_count_babies,
        guest_count_adults,
        allergies,
        guest_email,
      }])
      .select('id')
      .single();

    if (insertError) {
      console.error('RSVP insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save RSVP' });
    }

    const responseId = insertData?.id;
    const response   = {
      guest_name, attending, guest_count,
      guest_count_children, guest_count_babies, guest_count_adults,
      allergies, guest_email,
    };

    // ── 4. Count RSVPs received today ─────────────────────────
    // Per-day cap: first 15 of the day get instant notifications, the rest
    // (if today's count exceeds 15) get bundled into the 8pm daily digest.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: todayCount } = await supabase
      .from('guest_responses')
      .select('id', { count: 'exact', head: true })
      .eq('party_id', party_id)
      .gte('created_at', todayStart.toISOString());

    const sendIndividual = todayCount <= INDIVIDUAL_NOTIFICATION_LIMIT;

    // ── 5. Send emails ────────────────────────────────────────
    const emailPromises = [];

    if (sendIndividual) {
      emailPromises.push(
        sendEmail({
          to:      party.parent_email,
          subject: normaliseAttending(attending)
            ? `🎉 ${guest_name} is coming to ${party.child_name}'s party!`
            : `${guest_name} can't make it to ${party.child_name}'s party`,
          html: rsvpNotificationHtml({ party, response, todayCount }),
        }).catch(e => console.error('Host notification failed:', e.message))
      );
    }

    if (guest_email) {
      emailPromises.push(
        sendEmail({
          to:      guest_email,
          subject: normaliseAttending(attending)
            ? `You're confirmed for ${party.child_name}'s party! 🎉`
            : `Thanks for letting us know 💛`,
          html: guestConfirmationHtml({ party, response }),
        }).catch(e => console.error('Guest email failed:', e.message))
      );
    }

    await Promise.all(emailPromises);

    return res.status(200).json({ success: true, id: responseId });

  } catch (err) {
    console.error('submit-rsvp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
