// Updated: 2026-06-05
// api/unsubscribe-reminder.js  (also served as the handler for flat-structure builds)
//
// One-click unsubscribe for reminder and party-update emails.
// Linked from every email footer as GET /api/unsubscribe-reminder?id=<guest_id>
//
// Sets reminder_optin = false on the guest_responses row so the guest no
// longer receives reminders or host-broadcast updates.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function htmlPage(title, heading, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin:0; background:#faf6ef; font-family:'Helvetica Neue',Arial,sans-serif;
           display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { background:#fff9f2; border:1px solid #f5edda; border-radius:20px;
            padding:48px 40px; max-width:420px; width:90%; text-align:center; }
    .logo { font-family:Georgia,serif; font-style:italic; color:#c9a84c;
            font-size:1.1rem; margin-bottom:28px; }
    h1 { font-family:Georgia,serif; font-weight:400; color:#2a2218;
         font-size:1.6rem; margin:0 0 16px; line-height:1.3; }
    p  { color:#6b5c45; font-size:0.88rem; line-height:1.7; margin:0; }
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
  // Support both GET (email link click) and POST (List-Unsubscribe-Post header)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = (req.query?.id || req.body?.id || '').toString().trim();

  if (!id || !UUID_RE.test(id)) {
    return res.status(400).send(
      htmlPage('Invalid link', 'Invalid link',
        'This unsubscribe link is not valid. If you continue to receive emails, please reply and we\'ll remove you manually.')
    );
  }

  // Verify the row exists before updating
  const { data: guest, error: fetchError } = await supabase
    .from('guest_responses')
    .select('id, guest_name, reminder_optin')
    .eq('id', id)
    .single();

  if (fetchError || !guest) {
    return res.status(404).send(
      htmlPage('Not found', 'Link not recognised',
        'We couldn\'t find this subscription. You may have already been removed, or the link has expired.')
    );
  }

  // Idempotent — already opted out
  if (guest.reminder_optin === false) {
    return res.status(200).send(
      htmlPage('Already unsubscribed', 'You\'re already unsubscribed ✓',
        'You won\'t receive any more reminder or update emails for this party.')
    );
  }

  const { error: updateError } = await supabase
    .from('guest_responses')
    .update({ reminder_optin: false })
    .eq('id', id);

  if (updateError) {
    console.error('[unsubscribe-reminder]', updateError.message);
    return res.status(500).send(
      htmlPage('Error', 'Something went wrong',
        'We couldn\'t process your unsubscribe request. Please try again or reply to the email to be removed manually.')
    );
  }

  return res.status(200).send(
    htmlPage('Unsubscribed', 'You\'ve been unsubscribed ✓',
      'You won\'t receive any more reminder or update emails for this party. Your RSVP is still confirmed.')
  );
}
