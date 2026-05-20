import loadDashboard from './dashboard.js';
import updateGuest from './update-guest.js';
import sendGuestList from './send-email.js';

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
