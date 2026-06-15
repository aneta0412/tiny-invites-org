// Updated: 2026-06-04
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

// Escape guest-/host-supplied text before placing it in email HTML.
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function fmtPartyDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return ''; }
}

// Today's calendar date in Europe/London as "YYYY-MM-DD". Party dates and
// cutoffs are UK calendar dates, so we compare them as date strings anchored
// to London — avoiding UTC/local off-by-one bugs near midnight and across BST.
function londonTodayISO() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day}`;
}
// "14:00" -> "2pm" / "14:30" -> "2:30pm".
function fmtPartyTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const ampm = h >= 12 ? 'pm' : 'am';
  let hh = h % 12; if (hh === 0) hh = 12;
  return m ? `${hh}:${String(m).padStart(2, '0')}${ampm}` : `${hh}${ampm}`;
}
// "2pm–3:30pm" from a start time + duration in minutes (start only if no duration).
function fmtTimeRange(start, durMin) {
  if (!start) return '';
  const s = fmtPartyTime(start);
  const [h, m] = String(start).split(':').map(Number);
  if (!durMin || Number.isNaN(h)) return s;
  const tot = Math.min(h * 60 + m + Number(durMin), 23 * 60 + 59);
  const end = `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
  return `${s}–${fmtPartyTime(end)}`;
}
// "When" line combining date + time range, e.g. "Saturday, 12 July · 2pm–3:30pm".
function whenLineHtml(party) {
  const d = fmtPartyDate(party.party_date);
  const t = fmtTimeRange(party.party_time, party.party_duration_min);
  if (!d && !t) return '';
  const val = `${d}${d && t ? ' · ' : ''}${t}`;
  return `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 16px;">🗓️ <strong style="color:#2a2218;">${val}</strong></p>`;
}

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
      <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.3;">Thanks for letting us know, ${esc(response.guest_name)}</h1>
      <p style="font-size:0.87rem;color:#6b5c45;line-height:1.7;margin:0;">
        We've let the host know you can't make it to <strong>${esc(party.child_name)}'s ${ageStr}</strong>. We hope to celebrate together another time. 💛
      </p>
    `, party.photo_url || '');
  }
  return base(`
    <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">You're on the list! 🎉</p>
    <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 14px;line-height:1.3;">See you there, ${esc(response.guest_name)}!</h1>
    <p style="font-size:0.87rem;color:#6b5c45;line-height:1.7;margin:0 0 16px;">
      Your RSVP for <strong>${esc(party.child_name)}'s ${ageStr}</strong> is confirmed.${party.venue ? ` We'll see you at <strong>${esc(party.venue)}</strong>.` : ''} 🎈
    </p>
    ${whenLineHtml(party)}
    ${breakdown ? `<p style="font-size:0.82rem;color:#6b5c45;margin:0 0 10px;">👥 <strong>${breakdown}</strong> confirmed under your name</p>` : ''}
    ${response.allergies ? `<p style="font-size:0.82rem;color:#6b5c45;background:#fff3e0;border-left:3px solid #c9a84c;padding:10px 14px;border-radius:0 6px 6px 0;margin:0;">⚠️ Dietary note recorded: <strong>${esc(response.allergies)}</strong></p>` : ''}
  `, party.photo_url || '');
}

// Host-facing — includes the host footer.
function rsvpNotificationHtml({ party, response, todayCount, changedFrom = null }) {
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
  const changedBanner = changedFrom
    ? `<p style="font-size:0.8rem;background:#fff3e0;border-left:3px solid #c9a84c;padding:9px 14px;border-radius:0 6px 6px 0;margin:0 0 14px;color:#6b5c45;">
        🔄 <strong>Changed RSVP</strong> — previously said <strong>${changedFrom === 'yes' ? "they'd come" : "they couldn't make it"}</strong>.
       </p>`
    : '';
  return base(`
    <p style="font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#c9a84c;margin:0 0 12px;">${changedFrom ? 'Updated RSVP' : 'New RSVP'} ${emoji}</p>
    <h1 style="font-family:Georgia,serif;font-size:1.8rem;font-weight:400;color:#2a2218;margin:0 0 16px;line-height:1.3;">${esc(response.guest_name)} ${status}</h1>
    ${changedBanner}
    ${whenLineHtml(party)}
    ${attending && breakdown ? `<p style="font-size:0.85rem;color:#6b5c45;margin:0 0 8px;">👥 ${breakdown}</p>` : ''}
    ${response.allergies ? `<p style="font-size:0.85rem;color:#6b5c45;background:#fff3e0;border-left:3px solid #c9a84c;padding:10px 14px;border-radius:0 6px 6px 0;margin:0 0 12px;">${attending ? '⚠️ Dietary note' : '💬 Message from guest'}: <strong>${esc(response.allergies)}</strong></p>` : ''}
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
    const reminder_optin        = true;
    // Sent by the guest "didn't receive confirmation" flow — skip host notification
    const resend_only           = body._resend_only === true || body._resend_only === 'true';

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

    // ── Email now required for ATTENDING guests ──────────────
    // It's how the host reaches them (reminders + important updates), so we
    // enforce it server-side too — not just in the form. Declining guests
    // still don't need one (their decline never triggers a guest email).
    if (normaliseAttending(attending) && !guest_email)
      return res.status(400).json({ error: 'An email address is required to RSVP yes' });

    // ── Rate limit per party (anti-stuffing) ─────────────────
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

    // ── RSVP cutoff check ─────────────────────────────────
    // Compare as Europe/London date strings. slice(0,10) tolerates both the
    // date-only format and any legacy full-ISO value. RSVPs stay open through
    // the cutoff day and close the day after.
    if (party.rsvp_cutoff) {
      const cutoff = String(party.rsvp_cutoff).slice(0, 10);
      if (londonTodayISO() > cutoff) {
        return res.status(423).json({
          error: 'RSVPs for this party are now closed',
          code:  'RSVP_CLOSED',
        });
      }
    }

// ── 2. Duplicate check (name + email must both match) ────────
let existing = null;
let _rsvpChangedFrom = null;
if (guest_email) {
  const { data } = await supabase
    .from('guest_responses')
    .select('id, attending')            // ← need attending for status-change check
    .eq('party_id', party_id)
    .ilike('guest_name', guest_name)
    .ilike('guest_email', guest_email)
    .maybeSingle();
  existing = data;
}

if (existing) {
  const existingAttending = normaliseAttending(existing.attending);
  const newAttending      = normaliseAttending(attending);
  if (existingAttending !== newAttending) {
    // Status changed (yes→no or no→yes) — delete old, fall through to fresh INSERT
    await supabase.from('guest_responses').delete().eq('id', existing.id);
    _rsvpChangedFrom = existingAttending ? 'yes' : 'no';
    // fall through to step 3 (INSERT)
  } else {
    // Same status re-submitted — genuine duplicate, nothing to do
    return res.status(200).json({ success: true, duplicate: true, id: existing.id });
  }
}

    // ── 3. Save the RSVP ─────────────────────────────────────
    const { data: insertData, error: insertError } = await supabase
      .from('guest_responses')
      .insert([{
        party_id,
        guest_name,
        // Canonical 'yes'/'no' — update-guest.js writes the same, and
        // send-update.js filters on it. Raw true/'true' would silently
        // exclude these guests from host updates.
        attending: attending === null ? null : (normaliseAttending(attending) ? 'yes' : 'no'),
        guest_count,
        guest_count_children,
        guest_count_babies,
        guest_count_adults,
        allergies,
        guest_email,
        reminder_optin,
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
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { count: todayCount } = await supabase
      .from('guest_responses')
      .select('id', { count: 'exact', head: true })
      .eq('party_id', party_id)
      .gte('created_at', todayStart.toISOString());

    const sendIndividual = (todayCount ?? 0) <= INDIVIDUAL_NOTIFICATION_LIMIT;

    // ── 5. Send emails ────────────────────────────────────────
    // Host email always fires immediately — for both attending and declining
    // guests. For declines, the guest may optionally add a note afterward,
    // which triggers a separate follow-up email via send-decline-note.js.
    const emailPromises = [];

    if (sendIndividual) {
      const isAttending = normaliseAttending(attending);
      const subjectPrefix = _rsvpChangedFrom ? '🔄 Changed RSVP: ' : '';
      emailPromises.push(
        sendEmail({
          to:      party.parent_email,
          subject: isAttending
            ? `${subjectPrefix}🎉 ${guest_name} is coming to ${party.child_name}'s party!`
            : `${subjectPrefix}${guest_name} can't make it to ${party.child_name}'s party`,
          html: rsvpNotificationHtml({ party, response, todayCount: todayCount ?? 0, changedFrom: _rsvpChangedFrom }),
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

    return res.status(200).json({ success: true, id: responseId, response_id: responseId });

  } catch (err) {
    console.error('submit-rsvp error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
