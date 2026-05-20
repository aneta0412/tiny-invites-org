// Updated: 2026-05-20
// Router: /api/dashboard-api?action=load | update-guest | send-email
import loadDashboard from '../lib/dashboard.js';
import updateGuest from '../lib/update-guest.js';
import sendGuestList from '../lib/send-email.js';

const routes = {
  load: loadDashboard,
  'update-guest': updateGuest,
  'send-email': sendGuestList,
};

export default async function handler(req, res) {
  const action = req.query?.action || req.body?.action;
  const route = routes[action];

  if (!route) {
    return res.status(404).json({
      error: 'Unknown dashboard action',
      allowed: Object.keys(routes),
    });
  }

  return route(req, res);
}
