import dailyDigest from './daily-digest.js';

const routes = {
  'daily-digest': dailyDigest,
};

export default async function handler(req, res) {
  const action = req.query?.action || req.body?.action;
  const route = routes[action];

  if (!route) {
    return res.status(404).json({
      error: 'Unknown cron action',
      allowed: Object.keys(routes),
    });
  }

  return route(req, res);
}
