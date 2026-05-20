// Updated: 2026-05-20
// Router: /api/party?action=create-party | go-live | confirm-party | publish-party
import createParty from '../lib/create-party.js';
import goLive from '../lib/go-live.js';
import confirmParty from '../lib/confirm-party.js';
import publishParty from '../lib/publish-party.js';

const routes = {
  'create-party': createParty,
  'go-live': goLive,
  'confirm-party': confirmParty,
  'publish-party': publishParty,
};

export default async function handler(req, res) {
  const action = req.query?.action || req.body?.action;
  const route = routes[action];

  if (!route) {
    return res.status(404).json({
      error: 'Unknown party action',
      allowed: Object.keys(routes),
    });
  }

  return route(req, res);
}
