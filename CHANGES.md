# Changelog

Most recent first.

---

## 2026-06-15 — Party time, host copies, dashboard editing, timezone & cleanup

### New: obligatory party time
- Added a required **`party_time`** column (24-hour `HH:MM`). Migration: `migrations/2026-06-15-add-party-time.sql` (adds the column, backfills existing rows to `14:00`, sets `NOT NULL`, adds a format check). **Run it in Supabase before deploying.**
- `rsvp-host.html`: added a required **Party time** picker (with live invite preview) and a server check in `go-live.js`; `get-party.js` now exposes `party_time` publicly.
- The time now shows next to the date in **every** email (guest confirmation, host RSVP notification, welcome, go-live confirmation, resend, 3-day reminder, updates, daily digest, final list) and on the invite page + dashboard header.

### Calendar (the "ugly" add-to-calendar)
- The welcome email's **Add to calendar** button + attached `.ics` now use the entered start time as a **floating wall-clock time pinned to `Europe/London`** (`ctz=Europe/London`), instead of defaulting to midnight / shifting an hour during BST. Same fix applied to the dashboard's calendar buttons.
- Replaced the 📅 emoji (which renders as a fixed "JUL 17" glyph on Apple/Android, clashing with the real date) with the neutral 🗓 across all email date lines.

### Host copies of reminders & updates
- The host now receives a **copy** of the 3-days-before reminder (`api/cron/send-reminders.js`) and of every update they send (`lib/send-update.js`), each with a "your host copy" banner and no unsubscribe link. The dashboard notes that the host is included.

### Editable party details + RSVP deadline (new dashboard actions)
- **`update-party`** (`lib/update-party.js`): hosts can correct the **start time and/or venue** after go-live, without deleting and recreating the party (which would lose the RSVP link + QR). Date and photo stay locked. UI added to `dashboard_page.html` ("✏️ Edit time or venue"), with a nudge to send guests an update.
- **`extend-cutoff`** (`lib/extend-cutoff.js`): wired into the dashboard router (it was previously unreachable) and given a visible "🗓 Extend / reopen RSVPs" control. Fixed it to store `rsvp_cutoff` as a date-only string (a full ISO value would have silently disabled the cutoff check).

### After the cutoff (guest page)
- `rsvp.html`: when a guest opens an invite after the cutoff, they now see a **"Message the host"** button (relayed via `contact-host`, host email stays private) and the host's **phone number if one was provided**.

### Special note moved off the landing page
- Removed the "Special note for guests" field (and `note` URL param) from `index.html`; added it to the `rsvp-host.html` go-live form with live preview, so hosts reach their invite faster. Old `?note=` links still prefill.

### Timezone alignment (Europe/London)
- Both front-end and back-end now compute "today" as a `Europe/London` `YYYY-MM-DD` string and compare date strings — `submit-rsvp.js`, `get-party.js`, `rsvp.html`, `dashboard_page.html`, `extend-cutoff.js`. Previously the back-end used UTC and the front-end used the guest's local time, which could disagree by a day.

### Reliability / consistency
- `go-live.js`: replaced the in-memory per-instance rate limiter (ineffective on serverless) with the shared Upstash `enforceRateLimit`.
- `update-guest.js`: aligned the `guest_count` cap to 30 (matched `submit-rsvp.js`; was 60).
- Corrected the stale "Runs daily at 16:00 UTC" comment in the reminder cron (actual: 08:00).

### Cleanup (dead code)
- Deleted unused files: `lib/email-guestlist.js`, `lib/send-reminders.js`, `lib/send-guest-confirmation.js`, `lib/unsubscribe-reminder.js` (the live route is `api/unsubscribe-reminder.js`).
- Removed the unused `welcomeEmailHtml` / `guestConfirmationHtml` / `rsvpNotificationHtml` exports from `lib/send-email.js` (duplicate copies; the live versions live in `confirm-party.js` and `submit-rsvp.js`). Verified no dangling imports; `send-email.js` keeps the digest template + shared helpers.

### Tests
- Added `tests/run-tests.mjs` (run with `node tests/run-tests.mjs`) — 30 pure-logic tests covering time/date formatting, the `party_time` regex, calendar stamps, the London cutoff comparison, and the CSV formula-injection guard. **30/30 passing.**

### Verified
- All 29 backend JS files pass `node --check`; all inline HTML scripts parse; every relative import resolves to an existing file (no dangling references after deletions); the create → go-live → Supabase insert → confirm path is intact.

---

## 2026-06-11 review

### Round 2 (routers, crons, confirm/contact)

**Bugs**
- `dashboard.js`: the attending normaliser didn't recognise `'yes'` — every guest edited via the dashboard (and every new canonical row) displayed as **declined**. Same fix applied to the normalisers in `daily-digest.js`, `email-guestlist.js` and `send-email.js`'s handler.
- `daily-digest.js`: sent a digest from 2 responses/day upward, duplicating the individual notifications hosts already get for the first 15. Threshold now matches `INDIVIDUAL_NOTIFICATION_LIMIT`; one party's email failure no longer aborts every other party's digest; skips unconfirmed/email-less parties.
- `confirm-party.js`: now POST-only, matching `confirm.html` — GET confirm links get pre-fetched by email scanners, confirming parties before the host opens the email.
- `send-final-list.js`: `var(--gold-light)` in email CSS replaced with hex; CSV cells guarded against spreadsheet formula injection (`=`, `+`, `-`, `@`).
- `send-reminders.js`: attending filter now also matches legacy `'true'` rows.
- `dashboard.js`: invalid token returned a 500 with a raw Supabase message — now a 404; added method check.

**Security**
- All `CRON_SECRET` checks now **fail closed**: previously, if the env var was unset, sending the literal header `Bearer undefined` passed auth on five endpoints.
- `contact-host.js`: no longer relays messages for unconfirmed parties (spam vector); `mailto:` links use `esc()` instead of `encodeURIComponent`.
- `dashboard-api.js`: replaced the stale orphan router with the current action router plus a last-resort try/catch.

### Round 1 (core API)

**Security**
- `resolve-photo.js`: domain allowlist now checks the parsed **hostname** (old `url.includes(domain)` was bypassable, making the endpoint an open proxy). Protocol restricted to http/https; 8s fetch timeout.
- `send-email.js` / `send-guest-confirmation.js`: all user-supplied values escaped in email templates — previously stored-XSS into host/guest inboxes.
- `go-live.js`: `photo_url` restricted to http/https; `rsvp_cutoff` rejected if after the party date.
- `get-party.js`: unconfirmed parties return 404; UUID check accepts uppercase hex.
- Internal error details no longer returned to clients.

**Bugs**
- `submit-rsvp.js` stores `attending` canonically as `'yes'`/`'no'`. It previously stored raw `true`/`'true'`, and `send-update.js` filters on `'yes'` — attending guests were **silently excluded from host update emails**. `send-update.js` also matches legacy rows now.
- `send-update.js`: `.neq('reminder_optin', false)` excluded `NULL` rows — guests who never opted out were skipped. Now `NULL` or `true` both receive updates.
- `submit-rsvp.js`: duplicate-check `ilike` escapes `%`/`_`; `todayCount` null-guarded.
- Day-boundary maths switched to UTC (`submit-rsvp`, `send-decline-note`, `get-party`). *(Superseded 2026-06-15: now Europe/London string comparison.)*
- `confirm.html` POSTs the confirmation token.

**Error handling**
- Try/catch added around previously unguarded handler bodies; full error objects logged; `unsubscribe-reminder.js` sets an explicit HTML Content-Type.
