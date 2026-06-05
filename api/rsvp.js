// Updated: 2026-06-05
// Router: /api/rsvp?action=get-party | submit-rsvp | send-decline-note | contact-host
import getParty        from '../lib/get-party.js';
import submitRsvp      from '../lib/submit-rsvp.js';
import sendDeclineNote from '../lib/send-decline-note.js';
import contactHost     from '../lib/contact-host.js';

const routes = {
  'get-party':         getParty,
  'submit-rsvp':       submitRsvp,
  'send-decline-note': sendDeclineNote,
  'contact-host':      contactHost,
};

export default async function handler(req, res) {
  const action = req.query?.action || req.body?.action;
  const route = routes[action];

  if (!route) {
    return res.status(404).json({
      error: 'Unknown RSVP action',
      allowed: Object.keys(routes),
    });
  }

  return route(req, res);
}
