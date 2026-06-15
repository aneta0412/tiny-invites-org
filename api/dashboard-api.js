// Updated: 2026-06-11
// Router: /api/dashboard-api?action=load | update-guest | send-email | save-reminder-note | send-update | extend-cutoff | update-party
import loadDashboard    from '../lib/dashboard.js';
import updateGuest      from '../lib/update-guest.js';
import sendGuestList    from '../lib/send-email.js';
import saveReminderNote from '../lib/save-reminder-note.js';
import sendUpdate       from '../lib/send-update.js';
import extendCutoff     from '../lib/extend-cutoff.js';
import updateParty      from '../lib/update-party.js';

const routes = {
  'load':               loadDashboard,
  'update-guest':       updateGuest,
  'send-email':         sendGuestList,
  'save-reminder-note': saveReminderNote,
  'send-update':        sendUpdate,
  'extend-cutoff':      extendCutoff,
  'update-party':       updateParty,
};

export default async function handler(req, res) {
  const action = req.query?.action || req.body?.action;
  const route  = routes[action];

  if (!route) {
    return res.status(404).json({
      error:   'Unknown dashboard action',
      allowed: Object.keys(routes),
    });
  }

  try {
    return await route(req, res);
  } catch (err) {
    // Sub-handlers catch their own errors; this is the last-resort net so a
    // throw never escapes the function runtime as an unhandled rejection.
    console.error(`[dashboard-api] unhandled error in action "${action}":`, err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
