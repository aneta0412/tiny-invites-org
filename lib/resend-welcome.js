// Updated: 2026-06-12
// lib/resend-welcome.js
//
// Resends the post-confirmation welcome email (with RSVP link, QR code,
// Party Page link and 8 steps). Called from confirm.html when the host
// clicks "Resend confirmation email".
//
// Route: POST /api/party?action=resend-welcome
// Body:  { token }  — the dashboard_token

import { createClient } from '@supabase/supabase-js';
import { Resend }       from 'resend';
import { enforceRateLimit } from './rate-limit.js';
import { welcomeEmailHtml } from './confirm-party.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const ordinal = n => {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit: 3 resends per IP per 10 minutes
  if (await enforceRateLimit(req, res, {
    name:   'resend-welcome:ip',
    limit:  3,
    window: '10 m',
  })) return;

  try {
    const token = ((req.body || {}).token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const { data: party, error: lookupError } = await supabase
      .from('parties')
      .select('*')
      .eq('dashboard_token', token)
      .single();

    if (lookupError || !party) {
      return res.status(404).json({ error: 'Party not found' });
    }

    if (!party.confirmed) {
      return res.status(400).json({ error: 'Party has not been confirmed yet' });
    }

    const rsvpUrl = `https://tinyinvites.org/rsvp.html?party=${party.party_id}`;

    // Derive cutoff days
    let rsvpCutoffDays = 7;
    if (party.rsvp_cutoff && party.party_date) {
      try {
        const cutoff = new Date(party.rsvp_cutoff);
        const pDate  = new Date(party.party_date);
        const diff   = Math.round((pDate - cutoff) / (1000 * 60 * 60 * 24));
        if (diff > 0) rsvpCutoffDays = diff;
      } catch (_) {}
    }

    await resend.emails.send({
      from:    'Tiny Invites <hello@tinyinvites.org>',
      to:      party.parent_email,
      subject: `${party.child_name}'s RSVP page is live — here's everything you need`,
      html:    welcomeEmailHtml({
        child_name:      party.child_name,
        age:             party.age,
        venue:           party.venue,
        party_date:      party.party_date,
        party_time:      party.party_time || null,
        dashboard_token: token,
        party_id:        party.party_id,
        photo_url:       party.photo_url || '',
        rsvp_url:        rsvpUrl,
        rsvp_cutoff_days: rsvpCutoffDays,
      }),
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[resend-welcome] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
