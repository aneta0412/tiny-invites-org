# Tiny Invites — Backend

Serverless API for tinyinvites.org: free RSVP pages for children's birthday parties. Hosts create a party, confirm by email, and get a private dashboard; guests RSVP from a shareable link and receive confirmations, reminders, and host updates by email.

**Stack:** Vercel serverless functions (Node, ES modules) · Supabase (Postgres) · Resend (email) · Upstash Redis (rate limiting, optional).

---

## How it fits together

```
rsvp-host.html ──POST──▶ go-live.js ─────────────▶ parties (confirmed: false)
                                  └─ confirmation email ──▶ confirm.html ──POST──▶ confirm-party.js
                                                                                   └─ welcome email (RSVP link + QR + dashboard link)
rsvp.html ──GET──▶ get-party.js
          ──POST─▶ submit-rsvp.js ───────────────▶ guest_responses
                                  ├─ host notification email (≤15/day, then 8pm digest)
                                  └─ guest confirmation email
          ──POST─▶ contact-host.js / send-decline-note.js

dashboard_page.html ──▶ dashboard-api.js router:
                        load (dashboard.js) · update-guest · send-email (guest list) ·
                        save-reminder-note · send-update
email footers ──▶ unsubscribe-reminder.js (guests) · delete-party.html → delete-party.js (hosts)

Crons (Bearer CRON_SECRET):
  09:00 send-final-list.js   — final guest list + CSV on each party's cutoff day
  16:00 send-reminders.js    — guest reminders 3 days before the party
  20:00 daily-digest.js      — bundles overflow RSVPs (>15/day) per party
  03:00 cleanup-inactive-parties.js — deletes old/abandoned parties
```

Routing is via query-string actions on consolidated endpoints, e.g. `POST /api/rsvp?action=submit-rsvp`, `POST /api/party?action=go-live`, `POST /api/dashboard-api?action=load`.

## Files

| File | Route / role |
|---|---|
| `go-live.js` | `POST /api/party?action=go-live` — create party (unconfirmed), send confirmation + admin email. Honeypot field, rate-limited, duplicate check on email+date. |
| `confirm-party.js` | `POST /api/party?action=confirm-party` — flips `confirmed: true`, sends the welcome email (RSVP link, QR code, dashboard link) + admin notification. POST only — see changelog. |
| `resend-confirmation.js` | `POST /api/party?action=resend-confirmation` — resend or re-address the go-live confirmation. |
| `delete-party.js` | `POST /api/party?action=delete-party` — hard-delete party + responses. Requires `{ token, confirmed: true }`. Exports `deletePartyByToken` for the cleanup cron. |
| `get-party.js` | `GET /api/rsvp?action=get-party&id=<uuid>` — public party details (whitelisted columns only; never exposes `dashboard_token` / `parent_email`). 404 unknown/unconfirmed, 410 past. |
| `submit-rsvp.js` | `POST /api/rsvp?action=submit-rsvp` — save RSVP, notify host + guest. Handles duplicates, yes↔no changes, the `_resend_only` email-fix flow, and the RSVP cutoff (423). |
| `send-decline-note.js` | `POST /api/rsvp?action=send-decline-note` — optional note from a declining guest, relayed to the host. |
| `contact-host.js` | `POST /api/rsvp?action=contact-host` — relays a guest message to the host without exposing the host's email. Rate-limited; live parties only. |
| `send-guest-confirmation.js` | Re-send a guest their confirmation email. |
| `dashboard-api.js` | Router for the five dashboard actions (load / update-guest / send-email / save-reminder-note / send-update), with a last-resort error net. |
| `dashboard.js` | Dashboard `load`: party + responses + stats (token-authed). |
| `update-guest.js` | Dashboard: edit or delete a guest response (token-authed). |
| `send-update.js` | Dashboard: broadcast a host message to all attending, opted-in guests. RFC 8058 one-click unsubscribe headers. |
| `send-party-update.js` | `POST /api/send-party-update` — Bearer-`CRON_SECRET` wrapper around `send-update.js` for direct/external calls by `party_id`. |
| `email-guestlist.js` / `send-email.js` (default export) | Dashboard: email the host their guest list (optionally with contact emails). |
| `send-email.js` | Shared email library: `sendEmail`, `esc`, `ordinal`, `formatPartyDate`, `base` layout, `hostFooter`, and the welcome / confirmation / notification / digest templates. Host-facing emails get the delete-party footer; guest-facing never do. |
| `save-reminder-note.js` | Dashboard: save the host's note for the automatic 3-days-before reminder. |
| `unsubscribe-reminder.js` | `GET/POST /api/unsubscribe-reminder?id=<guest_id>` — one-click unsubscribe (HTML pages, RFC 8058 POST supported). |
| `daily-digest.js` | Cron — bundles each party's overflow RSVPs (>15 in a day) into one digest email. |
| `send-reminders.js` | Cron — emails attending, opted-in guests 3 days before the party; includes the host's reminder note. |
| `send-final-list.js` | Cron — on a party's `rsvp_cutoff` day, emails the host the final guest list with contacts + CSV attachment. |
| `cleanup-inactive-parties.js` (+ 2-line `api/` re-export wrapper) | Cron — deletes parties 60 days after `party_date`, and unconfirmed parties after 30 days. Confirmed parties without a date are left alone. |
| `resolve-photo.js` | Netlify-style function: resolve a Google Photos share link to a direct image URL (hostname-allowlisted). |
| `rate-limit.js` | Shared Upstash sliding-window limiter. Fails **open** if Redis env vars are missing or Redis errors (logged). |
| `create-party.js` | **Legacy?** Only validates a name and returns fresh UUIDs — writes nothing to the DB (`go-live.js` does the real insert). Confirm it's unused and remove. |
| `debug.js` | Code-review findings report — run `node debug.js`. |

## Environment variables

| Var | Used for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Database (service role — these functions are the trust boundary; keep them server-side only). |
| `RESEND_API_KEY` | All outbound email (`hello@tinyinvites.org`). |
| `CRON_SECRET` | Bearer auth for cron endpoints and `send-party-update`. **Must be set** — handlers now fail closed without it. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limiting. Optional — limiter disables itself (fails open) without them. |

## Conventions

- **Auth model:** guests are anonymous; hosts authenticate with the `dashboard_token` UUID from their emails; crons authenticate with `Bearer CRON_SECRET`. Anything that mutates a party or its guests must resolve `dashboard_token → party` first and scope every query by `party_id`.
- **`attending` is stored as the string `'yes'` / `'no'`** (canonicalised in `submit-rsvp.js` and `update-guest.js`). Reads must tolerate legacy `true`/`'true'` rows: normalise with `=== true || === 'true' || === 'yes'`, and filter with `.in('attending', ['yes', 'true'])`.
- **Escape everything user-supplied** before it goes into email HTML — use `esc()`. Guest names, venues, allergies and notes are attacker-controlled input to the *host's* inbox. CSS variables don't work in email HTML — use hex values.
- **Dates are date-only strings** (`YYYY-MM-DD`). Compare in UTC (`setUTCHours(0,0,0,0)` vs `new Date(d + 'T00:00:00Z')`) so behaviour doesn't depend on server region.
- **Error handling:** every handler wraps its body in try/catch, logs the **full error object** (stack included), and returns a generic message to the client — never `err.message`, which can leak internals (cron endpoints may return details since they're secret-authed). Email sends to guests/hosts are fire-and-forget (`.catch` + log): an email failure must never fail a saved RSVP. In multi-recipient loops (crons, send-update), wrap **each iteration** so one failure doesn't abort the rest.
- **Notification throttle:** hosts get at most 15 individual RSVP emails per day per party (`INDIVIDUAL_NOTIFICATION_LIMIT`); the 20:00 digest bundles the overflow.

## Changelog — 2026-06-11 review

### Round 2 (routers, crons, confirm/contact)

**Bugs**
- `dashboard.js`: the attending normaliser didn't recognise `'yes'` — every guest edited via the dashboard (and every new canonical row) displayed as **declined**. Same fix applied to the normalisers in `daily-digest.js`, `email-guestlist.js` and `send-email.js`'s handler.
- `daily-digest.js`: sent a digest from 2 responses/day upward, duplicating the individual notifications hosts already get for the first 15 (welcome-email copy says digests start after 15). Threshold now matches `INDIVIDUAL_NOTIFICATION_LIMIT`; one party's email failure no longer aborts every other party's digest; skips unconfirmed/email-less parties.
- `confirm-party.js`: now POST-only, matching the updated `confirm.html` — GET confirm links get pre-fetched by email scanners, confirming parties before the host opens the email.
- `send-final-list.js`: `var(--gold-light)` in email CSS (CSS variables don't work in email — replaced with hex); CSV cells are now guarded against spreadsheet formula injection (`=`, `+`, `-`, `@`).
- `send-reminders.js`: attending filter now also matches legacy `'true'` rows.
- `dashboard.js`: invalid token returned a 500 with a raw Supabase message — now a 404; added method check.

**Security**
- All `CRON_SECRET` checks now **fail closed**: previously, if the env var was unset, sending the literal header `Bearer undefined` passed auth on five endpoints.
- `contact-host.js`: no longer relays messages for unconfirmed parties (spam vector); `mailto:` links use `esc()` instead of `encodeURIComponent` (which mangles addresses in some clients).
- `dashboard-api.js`: replaced the stale orphan router (debug H4) with the current five-action router plus a last-resort try/catch so nothing escapes as an unhandled rejection.

### Round 1 (core API)

**Security**
- `resolve-photo.js`: domain allowlist now checks the parsed **hostname** (old `url.includes(domain)` was bypassable — `https://evil.com/?x=photos.google.com` — making the endpoint an open proxy). Protocol restricted to http/https; 8s fetch timeout.
- `send-email.js` / `send-guest-confirmation.js`: all user-supplied values escaped in email templates — previously stored-XSS into host/guest inboxes.
- `go-live.js`: `photo_url` restricted to http/https; `rsvp_cutoff` rejected if after the party date.
- `get-party.js`: unconfirmed parties return 404; UUID check accepts uppercase hex.
- Internal error details no longer returned to clients.

**Bugs**
- `submit-rsvp.js` stores `attending` canonically as `'yes'`/`'no'`. It previously stored raw `true`/`'true'`, and `send-update.js` filters on `'yes'` — attending guests were **silently excluded from host update emails**. `send-update.js` also matches legacy rows now.
- `send-update.js`: `.neq('reminder_optin', false)` excluded `NULL` rows (Postgres null semantics) — guests who never opted out were skipped. Now `NULL` or `true` both receive updates.
- `submit-rsvp.js`: duplicate-check `ilike` escapes `%`/`_`; `todayCount` null-guarded.
- Day-boundary maths switched to UTC (`submit-rsvp`, `send-decline-note`, `get-party`).
- `confirm.html` POSTs the confirmation token (paired with the confirm-party change above).

**Error handling**
- Try/catch added around previously unguarded handler bodies (`send-update`, `save-reminder-note`, `resend-confirmation`, `unsubscribe-reminder`, `dashboard`); full error objects logged everywhere (stacks preserved); `unsubscribe-reminder.js` sets an explicit HTML Content-Type.

## Known issues / next up

- **Delete the orphan files**: `unsubscribe-reminder-e293a8d2.js` (stale pre-fix copy of `unsubscribe-reminder.js`) and the old `dashboard-api-0c322cf7.js` if still deployed. Duplicate routes = non-deterministic routing.
- **`create-party.js` looks dead** — it returns UUIDs without writing anything. Confirm nothing calls it and remove.
- **`vercel.json` not reviewed** — verify all four crons are wired (daily-digest, send-reminders, send-final-list, cleanup-inactive-parties) with the schedules above (debug C1).
- **`/delete-party.html` page** referenced by every host email footer still needs to exist (debug H3).
- `submit-rsvp` deduplicates by guest name only — two guests with the same name in one party collide (H2).
- `guest_count` cap differs between create (30) and edit (60) (M1); hoist to a shared constant.
- `go-live.js` still uses its in-memory per-instance rate limiter; switch to the shared Upstash `enforceRateLimit` for consistency.
- Cleanup deletes silently — a "your party will be deleted in 7 days" warning email with a keep-alive link would be friendlier (M3/S3); hosts also get no email on manual deletion (L3).
- Reminder cron requires `reminder_optin === true` — guests with `NULL` (legacy) silently get no reminder; decide whether `NULL` should count as opted-in (it does for send-update).
- The confirm email's "expires in 24 hours" copy (if still present in templates) has no matching expiry check (M4).
- No automated tests — a small mocked-Resend integration test over each handler would have caught most of the above (S2).
