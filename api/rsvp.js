// Updated: 2026-05-20
// Router: /api/rsvp?action=get-party | submit-rsvp
import getParty from '../lib/get-party.js';
import submitRsvp from '../lib/submit-rsvp.js';

const routes = {
  'get-party': getParty,
  'submit-rsvp': submitRsvp,
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
