# Tiny Invites — Backend

Serverless API for **tinyinvites.org**: free RSVP pages for children's birthday parties. A host creates a party, confirms it by email, and gets a private dashboard; guests RSVP from a shareable link and receive confirmations, reminders, and host updates by email.

**Stack:** Vercel serverless functions (Node, ES modules) · Supabase (Postgres) · Resend (email) · Upstash Redis (rate limiting, optional).

> For the full history of changes (including this session's work), see **[CHANGES.md](./CHANGES.md)**.

---

## How it fits together

```
rsvp-host.html ──POST──▶ go-live.js ─────────────▶ parties (confirmed: false)   ← the Supabase row is created HERE
                                  └─ "confirm your email" email ──▶ confirm.html ──POST──▶ confirm-party.js
                                                                                          └─ flips confirmed: true,
                                                                                             welcome email (RSVP link + QR + .ics + dashboard link)
rsvp.html ──GET──▶ get-party.js                       (public party details)
          ──POST─▶ submit-rsvp.js ───────────────▶ guest_responses
                                  ├─ host notification email (≤15/day, then 19:00 digest)
                                  └─ guest confirmation email
          ──POST─▶ contact-host.js / send-decline-note.js

dashboard_page.html ──▶ dashboard-api.js router:
                        load · update-guest · send-email (guest list) ·
                        save-reminder-note · send-update · extend-cutoff · update-party

email footers ──▶ /api/unsubscribe-reminder (guests) · /delete-party.html → delete-party.js (hosts)

Crons (Bearer CRON_SECRET, times UTC — see vercel.json):
  03:00  cleanup-inactive-parties.js  — deletes old/abandoned parties
  06:00  send-final-list.js           — final guest list + CSV on each party's cutoff day
  08:00  send-reminders.js            — guest reminders 3 days before the party (+ a host copy)
  19:00  daily-digest.js              — bundles overflow RSVPs (>15/day) per party
```

**Note on party creation:** `create-party.js` only validates a name and returns fresh UUIDs — it does **not** write to the database. The actual Supabase `parties` row is inserted by **`go-live.js`**, and `confirm-party.js` later flips `confirmed: true`. This split is intentional; don't remove `create-party.js` without re-checking the front-end flow.

Routing is via query-string actions on consolidated endpoints, e.g. `POST /api/rsvp?action=submit-rsvp`, `POST /api/party?action=go-live`, `POST /api/dashboard-api?action=load`.

## Files

### `api/` — Vercel entrypoints (HTTP routes)

| File | Role |
|---|---|
| `party.js` | Router: `create-party`, `go-live`, `confirm-party`, `delete-party`, `resend-confirmation`, `resend-welcome`. |
| `rsvp.js` | Router: `get-party`, `submit-rsvp`, `send-decline-note`, `contact-host`. |
| `dashboard-api.js` | Router (token-authed): `load`, `update-guest`, `send-email`, `save-reminder-note`, `send-update`, `extend-cutoff`, `update-party`. |
| `send-party-update.js` | `POST /api/send-party-update` — Bearer-`CRON_SECRET` wrapper around `send-update` for external calls by `party_id`. |
| `unsubscribe-reminder.js` | `GET/POST /api/unsubscribe-reminder?id=<guest_id>` — one-click unsubscribe (RFC 8058). |
| `cleanup-inactive-parties.js` | Cron entry — delegates to `lib/delete-party.js`. |
| `cron/daily-digest.js` | Cron — bundles each party's overflow RSVPs (>15/day) into one digest. |
| `cron/send-reminders.js` | Cron — emails attending guests 3 days before the party (host note included), **plus a host copy**. |
| `cron/send-final-list.js` | Cron — on a party's `rsvp_cutoff` day, emails the host the final guest list + CSV. |

### `lib/` — handlers & shared modules

| File | Role |
|---|---|
| `go-live.js` | Create the party (unconfirmed) **and insert the Supabase row**; send confirmation + admin email. Honeypot, Upstash rate-limited, duplicate check on email+date. |
| `confirm-party.js` | Flip `confirmed: true`; send the welcome email (RSVP link, QR, **Add-to-calendar + .ics**) + admin email. POST-only (email scanners pre-fetch GET). |
| `resend-confirmation.js` / `resend-welcome.js` | Resend the go-live confirmation / the post-confirmation welcome. |
| `delete-party.js` | Hard-delete party + responses (requires `{ token, confirmed: true }`); also used by the cleanup cron. |
| `get-party.js` | Public party details (whitelisted columns; never `dashboard_token`/`parent_email`). 404 unknown/unconfirmed, 410 past. |
| `submit-rsvp.js` | Save RSVP; notify host + guest. Handles duplicates, yes↔no changes, the email-fix flow, and the RSVP cutoff (423). |
| `send-decline-note.js` | Optional note from a declining guest, relayed to the host. |
| `contact-host.js` | Relay a guest message to the host without exposing the host's email. Rate-limited; live parties only. |
| `dashboard.js` | Dashboard `load`: party + responses + stats (token-authed). |
| `update-guest.js` | Dashboard: edit/delete a guest response. |
| `update-party.js` | Dashboard: edit the party **start time and/or venue** after go-live (date & photo stay locked). |
| `extend-cutoff.js` | Dashboard: push the RSVP deadline later or reopen a closed party. |
| `save-reminder-note.js` | Dashboard: save the host's note for the 3-days-before reminder. |
| `send-update.js` | Dashboard: broadcast a host message to all attending guests, **plus a host copy**. |
| `send-email.js` | Shared email library: `sendEmail`, `esc`, `ordinal`, `formatPartyDate`, `formatPartyTime`, `base` layout, `btn`, `hostFooter`, and the **digest** template. Default export emails the host their guest list. |
| `rate-limit.js` | Shared Upstash sliding-window limiter. Fails **open** if Redis env vars are missing/error (logged). |
| `resolve-photo.js` | Resolve a Google Photos share link to a direct image URL (hostname-allowlisted). |
| `create-party.js` | Validates a name and returns fresh UUIDs. **Writes nothing** — the real insert is in `go-live.js`. |
| `debug.js` | Code-review findings report. |

## Data model (Supabase)

**`parties`** — `party_id` (uuid), `dashboard_token` (uuid, private), `child_name`, `age`, `venue`, `parent_email`, `photo_url`, `special_note`, `party_date` (`YYYY-MM-DD`), **`party_time`** (`HH:MM`, 24-hour, **NOT NULL**), `count_adults`, `count_babies`, `rsvp_cutoff` (`YYYY-MM-DD`), `phone_number`, `confirmed`, `confirmed_at`, `reminder_note`.

**`guest_responses`** — `id`, `party_id`, `guest_name`, `guest_email`, `attending` (`'yes'`/`'no'`), `guest_count`, `guest_count_children`, `guest_count_adults`, `guest_count_babies`, `allergies`, `reminder_optin`, `created_at`.

## Database migrations

Run SQL in the Supabase SQL editor. Migrations live in `migrations/`:

- **`migrations/2026-06-15-combined-party-time-and-duration.sql`** — adds the obligatory `party_time` column (backfills existing rows to `14:00`, `NOT NULL`, `HH:MM` format check) **and** `party_duration_min` (party length in minutes, `NOT NULL DEFAULT 90`, 15–480 range check). Idempotent — safe to run even if a prior version was already applied. **Run this before deploying** the party-time / duration changes.

## Environment variables

| Var | Used for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Database (service role — keep server-side only). |
| `RESEND_API_KEY` | All outbound email (`hello@tinyinvites.org`). |
| `CRON_SECRET` | Bearer auth for cron endpoints and `send-party-update`. **Must be set** — handlers fail closed without it. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limiting. Optional — limiter fails open (disabled) without them. |

## Tests

Pure-logic tests (no live services needed) run with plain Node:

```bash
node tests/run-tests.mjs
```

They cover time/date formatting, the `party_time` regex, calendar stamp generation, the Europe/London RSVP-cutoff comparison, and the CSV formula-injection guard. Current status: **30/30 passing**.

## Conventions

- **Auth model:** guests are anonymous; hosts authenticate with the `dashboard_token` UUID from their emails; crons authenticate with `Bearer CRON_SECRET`. Anything that mutates a party or its guests must resolve `dashboard_token → party` first and scope every query by `party_id`.
- **`attending` is the string `'yes'`/`'no'`** (canonicalised in `submit-rsvp.js` / `update-guest.js`). Reads tolerate legacy `true`/`'true'`: normalise with `=== true || === 'true' || === 'yes'` and filter with `.in('attending', ['yes', 'true'])`.
- **Host vs guest emails are different.** Host-facing emails (welcome, RSVP notification, digest, final list, contact-host relay, decline note, and the host *copies* of reminders/updates) carry the delete-party `hostFooter`. Guest-facing emails (confirmation, reminder, update) never do and instead carry an unsubscribe link.
- **Escape everything user-supplied** before email HTML — use `esc()`. CSS variables don't work in email; use hex.
- **Dates are date-only strings (`YYYY-MM-DD`) compared in Europe/London.** Both front-end and back-end derive "today" via `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London' })` and compare date strings, so cutoff/past behaviour is identical for guests in any timezone. Calendar `.ics`/Google times use the entered wall-clock time pinned to `Europe/London`.
- **Error handling:** every handler wraps its body in try/catch, logs the full error, and returns a generic message to the client. Guest/host email sends are fire-and-forget (`.catch` + log) — an email failure must never fail a saved RSVP. Multi-recipient loops wrap each iteration.
- **Notification throttle:** hosts get at most 15 individual RSVP emails per day per party (`INDIVIDUAL_NOTIFICATION_LIMIT`); the 19:00 digest bundles the overflow.

## Known issues / next up

- `submit-rsvp` deduplicates by guest name only — two guests with the same name in one party collide.
- Calendar `.ics` uses floating local time pinned to UK time — correct for UK guests; a `VTIMEZONE` block would make it exact for guests abroad.
- `party_time` has no end time; calendar events assume a 2-hour duration.
- **Localization is hard-coded to the UK.** All date/time logic is anchored to `Europe/London`, and dates are formatted with the `en-GB` locale (e.g. "Saturday, 18 July · 2pm"), the `.ics`/Google calendar times are pinned to `Europe/London`, and the reminder cron matches party dates in London time. **If the app is ever offered in another region or language (e.g. a German page), this must be revisited:** the timezone should become per-party (stored alongside `party_date`/`party_time`) and the locale passed to `Intl`/`toLocaleDateString` should follow the page language (e.g. `de-DE` + `Europe/Berlin`). Search the codebase for `Europe/London` and `en-GB` to find every place that needs adjusting (`submit-rsvp.js`, `get-party.js`, `extend-cutoff.js`, `confirm-party.js`, the cron jobs, `rsvp.html`, `dashboard_page.html`, `rsvp-host.html`).
- `lib/debug.js` contains stale text notes referencing now-deleted files (descriptive strings only — not imports).
