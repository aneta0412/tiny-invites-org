// Updated: 2026-06-05
// api/unsubscribe-reminder.js
//
// One-click unsubscribe for reminder and party-update emails.
// Linked from every email footer as GET /api/unsubscribe-reminder?id=<guest_id>
// Also handles List-Unsubscribe-Post (RFC 8058) via POST.
//
// Sets reminder_optin = false on the guest_responses row.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title, heading, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Tiny Invites</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#faf6ef;font-family:'Helvetica Neue',Arial,sans-serif;
         display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
    .card{background:#fff9f2;border:1px solid #f5edda;border-radius:20px;
          padding:48px 40px;max-width:440px;width:100%;text-align:center}
    .logo{font-family:Georgia,serif;font-style:italic;color:#c9a84c;font-size:1.1rem;margin-bottom:28px}
    h1{font-family:Georgia,serif;font-weight:400;color:#2a2218;font-size:1.6rem;margin:0 0 16px;line-height:1.3}
    p{color:#6b5c45;font-size:0.88rem;line-height:1.7;margin:0}
    a{color:#c9a84c;text-decoration:none}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Tiny Invites</div>
    <h1>${heading}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = String(req.query?.id || req.body?.id || '').trim();

  if (!id || !UUID_RE.test(id)) {
    return res.status(400).send(
      page('Invalid link', 'Invalid link',
        'This unsubscribe link doesn\'t look right. If you keep receiving emails please <a href="mailto:hello@tinyinvites.org">contact us</a> and we\'ll remove you manually.')
    );
  }

  const { data: guest, error: fetchErr } = await supabase
    .from('guest_responses')
    .select('id, reminder_optin')
    .eq('id', id)
    .single();

  if (fetchErr || !guest) {
    return res.status(404).send(
      page('Not found', 'Link not recognised',
        'We couldn\'t find this subscription — you may have already been removed, or the link has expired. <a href="mailto:hello@tinyinvites.org">Contact us</a> if you need help.')
    );
  }

  if (guest.reminder_optin === false) {
    return res.status(200).send(
      page('Already done', 'You\'re already unsubscribed ✓',
        'You won\'t receive any more reminder or update emails for this party.')
    );
  }

  const { error: updateErr } = await supabase
    .from('guest_responses')
    .update({ reminder_optin: false })
    .eq('id', id);

  if (updateErr) {
    console.error('[unsubscribe-reminder]', updateErr.message);
    return res.status(500).send(
      page('Error', 'Something went wrong',
        'We couldn\'t process your request. Please <a href="mailto:hello@tinyinvites.org">email us</a> and we\'ll remove you manually.')
    );
  }

  return res.status(200).send(
    page('Unsubscribed', 'You\'ve been unsubscribed ✓',
      'You won\'t receive any more reminder or update emails for this party. Your RSVP is still confirmed.')
  );
}
