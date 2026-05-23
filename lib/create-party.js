// Updated: 2026-05-23
// create-party.js
import { randomUUID }       from 'crypto';
import { enforceRateLimit } from './lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Rate limit (TC12) ─────────────────────────────────────
  // 10 party creations per IP per hour. Generous for real users (multiple
  // kids / re-tries), tight enough to make scripted spam unproductive.
  if (await enforceRateLimit(req, res, {
    name:   'create-party',
    limit:  10,
    window: '1 h',
  })) return;

  try {
    const body = req.body || {};

    // ── Validation ────────────────────────────────────────────
    const child_name = typeof body.child_name === 'string'
      ? body.child_name.trim()
      : null;

    if (!child_name) {
      return res.status(400).json({ error: 'Missing child_name' });
    }

    if (child_name.length > 100) {
      return res.status(400).json({ error: 'child_name too long (max 100 chars)' });
    }

    // ── Generate IDs ──────────────────────────────────────────
    const party_id        = randomUUID();
    const dashboard_token = randomUUID();

    return res.status(200).json({
      success: true,
      party_id,
      dashboard_token,
    });

  } catch (err) {
    console.error('create-party error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
