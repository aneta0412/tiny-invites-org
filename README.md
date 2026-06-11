# Tiny Invites — Backend

Serverless API for tinyinvites.org: free RSVP pages for children's birthday parties. Hosts create a party, confirm by email, and get a private dashboard; guests RSVP from a shareable link and receive confirmations, reminders, and host updates by email.

**Stack:** Vercel serverless functions (Node, ES modules) · Supabase (Postgres) · Resend (email) · Upstash Redis (rate limiting, optional).

---

## How it fits together

```
rsvp-host.html ──POST──▶ go-live.js ──────────▶ parties (confirmed: false)
                                 └─ confirmation email ──▶ confirm.html ──POST──▶ confirm-party (not in this repo)
rsvp.html ──GET──▶ get-party.js
          ──POST─▶ submit-rsvp.js ────────────▶ guest_responses
                                 ├─ host notification email (≤15/day, then 8pm digest)
                                 └─ guest confirmation email
dashboard_page.html ──▶ update-guest.js / send-update.js / email-guestlist.js /
                        save-reminder-note.js / delete-party.js   (all token-authed)
email footers ──▶ unsubscribe-reminder.js (guests) · delete-party.html (hosts)
```

Routing is via query-string actions on consolidated endpoints, e.g. `POST /api/rsvp?action=submit-rsvp`, `POST /api/party?action=go-live`.

## Files

| File | Route / role |
|---|---|
| `go-live.js` | `POST /api/party?action=go-live` — create party (unconfirmed), send confirmation + admin email. Honeypot field, rate-limited, duplicate check on email+date. |
| `resend-confirmation.js` | `POST /api/party?action=resend-confirmation` — resend or re-address the go-live confirmation. |
| `delete-party.js` | `POST /api/party?action=delete-party` — hard-delete party + responses. Requires `{ token, confirmed: true }`. Exports `deletePartyByToken` for the cleanup cron. |
| `get-party.js` | `GET /api/rsvp?action=get-party&id=<uuid>` — public party details (whitelisted columns only; never exposes `dashboard_token` / `parent_email`). 404 unknown/unconfirmed, 410 past. |
| `submit-rsvp.js` | `POST /api/rsvp?action=submit-rsvp` — save RSVP, notify host + guest. Handles duplicates, yes↔no changes, the `_resend_only` email-fix flow, and the RSVP cutoff (423). |
| `send-decline-note.js` | `POST /api/rsvp?action=send-decline-note` — optional note from a declining guest, relayed to the host. |
| `send-guest-confirmation.js` | Re-send a guest their confirmation email. |
| `update-guest.js` | Dashboard: edit or delete a guest response (token-authed). |
| `send-update.js` | Dashboard: broadcast a host message to all attending, opted-in guests. RFC 8058 one-click unsubscribe headers. |
| `email-guestlist.js` / `send-email.js` (default export) | Dashboard: email the host their guest list (optionally with contact emails). |
| `send-email.js` | Shared email library: `sendEmail`, `esc`, `ordinal`, `formatPartyDate`, `base` layout, `hostFooter`, and the welcome / confirmation / notification / digest templates. Host-facing emails get the delete-party footer; guest-facing never do. |
| `save-reminder-note.js` | Dashboard: save the host's note for the automatic 3-days-before reminder. |
| `unsubscribe-reminder.js` | `GET/POST /api/unsubscribe-reminder?id=<guest_id>` — one-click unsubscribe (HTML pages, RFC 8058 POST supported). |
| `resolve-photo.js` | Netlify-style function: resolve a Google Photos share link to a direct image URL (hostname-allowlisted). |
| `rate-limit.js` | Shared Upstash sliding-window limiter. Fails **open** if Redis env vars are missing or Redis errors (logged). |
| `debug.js` | Code-review findings report — run `node debug.js`. |

## Environment variables

| Var | Used for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Database (service role — these functions are the trust boundary; keep them server-side only). |
| `RESEND_API_KEY` | All outbound email (`hello@tinyinvites.org`). |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limiting. Optional — limiter disables itself (fails open) without them. |

## Conventions

- **Auth model:** guests are anonymous; hosts authenticate with the `dashboard_token` UUID from their emails. Anything that mutates a party or its guests must resolve `dashboard_token → party` first and scope every query by `party_id`.
- **`attending` is stored as the string `'yes'` / `'no'`** (canonicalised in `submit-rsvp.js` and `update-guest.js`). Reads still tolerate legacy `true`/`'true'` rows; queries should match both (see `send-update.js`).
- **Escape everything user-supplied** before it goes into email HTML — use `esc()` from `send-email.js`. Guest names, venues, allergies and notes are attacker-controlled input to the *host's* inbox.
- **Dates are date-only strings** (`YYYY-MM-DD`). Compare in UTC (`setUTCHours(0,0,0,0)` vs `new Date(d + 'T00:00:00Z')`) so behaviour doesn't depend on server region.
- **Error handling:** every handler wraps its body in try/catch, logs the **full error object** (stack included), and returns a generic message to the client — never `err.message`, which can leak internals. Email sends to guests/hosts are fire-and-forget (`.catch` + log): an email failure must never fail a saved RSVP.
- **Notification throttle:** hosts get at most 15 individual RSVP emails per day per party; the rest land in the 8pm digest cron.

## Changelog — 2026-06-11 review

Fixes applied in this pass:

**Security**
- `resolve-photo.js`: domain allowlist now checks the parsed **hostname** (the old `url.includes(domain)` check was bypassable — `https://evil.com/?x=photos.google.com` — making the endpoint an open proxy). Protocol restricted to http/https; 8s fetch timeout added.
- `send-email.js` / `send-guest-confirmation.js`: all user-supplied values (guest names, venues, allergies, emails, child name) are now escaped in email templates — previously stored-XSS into host/guest inboxes.
- `go-live.js`: `photo_url` restricted to http/https; `rsvp_cutoff` rejected if after the party date.
- `get-party.js`: unconfirmed parties now return 404 (no more pre-confirmation data exposure); UUID check accepts uppercase hex.
- Internal error details no longer returned to clients (`get-party`, `email-guestlist`, `send-guest-confirmation`, `send-email`).

**Bugs**
- `submit-rsvp.js` now stores `attending` canonically as `'yes'`/`'no'`. Previously it stored the raw value (`true`/`'true'`), and `send-update.js` filters on `'yes'` — so attending guests were **silently excluded from host update emails**. `send-update.js` also matches legacy `'true'` rows.
- `send-update.js`: `.neq('reminder_optin', false)` excluded `NULL` rows (Postgres null semantics) — guests who never touched the opt-out were skipped. Now `NULL` or `true` both receive updates.
- `submit-rsvp.js`: duplicate-check `ilike` now escapes `%`/`_` in guest names; `todayCount` null-guarded.
- Day-boundary calculations switched to UTC (`submit-rsvp`, `send-decline-note`, `get-party`) so cutoffs and digest counters can't drift by deploy region.
- `confirm.html` now **POSTs** the confirmation token. The old GET link could be triggered by email scanners (Outlook/Gmail pre-fetch), confirming parties before the host opened the email. The confirm-party handler should now reject GET.

**Error handling**
- Try/catch added around previously unguarded handler bodies (`send-update`, `save-reminder-note`, `resend-confirmation`, `unsubscribe-reminder`) — a Supabase network error there was an unhandled rejection.
- All catch blocks log the full error object instead of `err.message` (keeps stacks in the logs).
- `unsubscribe-reminder.js` sets an explicit `Content-Type: text/html` header.

## Known issues / next up (see `debug.js` for detail)

- Open findings from the prior review that need files outside this folder: cleanup cron not wired in `vercel.json` (C1); confirm-party handler should reject GET to match the new confirm.html (H1); `/delete-party.html` page referenced by email footers doesn't exist yet (H3); stale `dashboard-api-0c322cf7.js` router (H4); confirm-link "expires in 24 hours" copy with no expiry check (M4).
- `submit-rsvp` deduplicates by guest name only — two guests with the same name in one party collide (H2).
- `guest_count` cap differs between create (30) and edit (60) (M1).
- `go-live.js` still uses its in-memory per-instance rate limiter; consider switching it to the shared Upstash `enforceRateLimit` for consistency.
- Hosts get no email on party deletion, and the 60-day cleanup deletes silently (L3/M3) — a warning email with a "keep my party" link would be friendlier.
- The `_resend_only` flag on submit-rsvp is client-supplied; the server correctly limits it to updating email + resending, but worth keeping in mind.
- No automated tests — a small mocked-Resend integration test over each handler would have caught most of the above (S2).
