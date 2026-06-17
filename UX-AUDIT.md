# Tiny Invites — Aggressive UX Audit

_Walked the full product as four personas: **tired parent in a rush**, **confused first-time visitor**, **impatient mobile user**, and **user with bad internet**. Findings are evidence-based with file references and grouped by severity at the end._

---

## What I changed first (the "missing thing" you named)

**After the RSVP cutoff, time / duration / venue editing is now locked** on the dashboard — front-end *and* server-side.

- `dashboard_page.html` — once `isPastCutoff()` is true the "✏️ Edit time or venue" button is hidden, the panel collapses, and a note appears: _"🔒 Time & venue are locked now that RSVPs have closed. Reopen RSVPs first."_ `toggleEditDetails()` / `savePartyDetails()` also bail out defensively.
- `lib/update-party.js` — the API now loads `rsvp_cutoff` and returns **409 `CUTOFF_PASSED`** if the cutoff has passed (London time), so a stale tab or direct API call can't bypass the lock.

The host can still **Reopen RSVPs** (extend the cutoff) and then edit — so it's a guard rail, not a wall. Applied to both `-4` and `-5`.

---

## Persona walk-throughs

### 🏃 Tired parent in a rush
- Homepage create form is short (name, age, location) — good. But it does **not** collect date or time. Those are only asked on the next page (`rsvp-host.html`), so the parent who thinks "great, two boxes, done" hits a second, longer form (email, date, time, duration, consent, + optional phone/note/counting). Expectation mismatch → some drop here.
- Validation across the create + go-live flow uses **native `alert()` pop-ups, one field at a time** (3 on the homepage, 8 in rsvp-host). A rushing parent fixes one field, clicks again, gets the next alert. Slow and irritating versus inline highlighting.
- Good: past-date is a soft `confirm()` warning, not a block. Good: "Free, always. No account required." reassurance under the button.

### 🤔 Confused first-time visitor
- Strong: hero explains the product, there's a "Watch the quick video" link, and an FAQ.
- The post-submit "Check your inbox" card contains contradictory copy: _"Entered the wrong email address? Please go back and complete the form again, **as this party cannot be confirmed.**"_ — yet directly below is a working **fix-email + resend** panel and a "message us to confirm manually" link. The scary "cannot be confirmed" sentence reads like a dead end and undercuts the recovery tools right beneath it.
- Two CTAs on the hero ("Find a venue" and "Create your invite") are both styled as primary buttons — mild "which do I press first?" ambiguity for a first-timer.

### 📱 Impatient mobile user
- All pages have a proper `viewport` meta — good. Skeleton/loading states exist on dashboard, venue and rsvp pages.
- Party Finder is **postcode-only** — there is no "📍 Use my location" button (`navigator.geolocation` is unused). On a phone, typing a full postcode is the slowest possible entry; one tap to geolocate is the expected shortcut.
- A bad postcode triggers a native `alert("Postcode not recognised…")` rather than an inline message under the field. It does list examples, which softens it.
- Heavy `alert()`/`confirm()` use (17 across guest-facing pages) is especially clumsy on mobile — each one blocks the whole screen.

### 🐌 User with bad internet
- Solid foundations: `fetchWithTimeout` everywhere, friendly `describeFetchError()` ("Request timed out…", "Network error…"), a 12s budget on go-live, 429 handling, and an **offline fallback** for the venue list (`/api/venues` → inline DB).
- **The weak spot:** on the guest RSVP page, if `get-party` fails or times out (6s), the catch silently calls `renderInvite({})`. The page then shows a *partial* invite built from URL params — child's name/location, but **no real date, time, or special note**, and **no error or retry prompt** (`rsvp.html:501`). A guest on a flaky connection sees what looks like a complete invite that is actually missing *when the party is*, and can still submit an RSVP. This is silent degradation with no signal.

---

## Final output

### 🔴 Critical
1. **Guest RSVP page fails silently on a slow/failed load.** `rsvp.html:501` — a failed/timed-out `get-party` falls back to `renderInvite({})`, rendering an invite with no date/time and no error or "retry" affordance. The core purpose (telling a guest *when & where*) silently breaks on bad internet, and the guest can RSVP anyway. **Fix:** show a non-blocking "Couldn't load the latest party details — check your connection and retry" banner with a retry button instead of rendering a half-empty invite.

_(No data-loss or security-breaking bugs found — the cutoff-edit gap you flagged was the one real functional hole and is now closed.)_

### 🟠 Medium
1. **Contradictory "cannot be confirmed" copy** on the check-inbox card (`rsvp-host.html:430`) directly contradicts the fix/resend panel below it. Remove or soften — it manufactures a dead end where a recovery path exists.
2. **Native `alert()`/`confirm()` for all validation** (17 instances). Replace with inline field errors / a styled toast (a `showToast` helper already exists in the dashboard). Biggest payoff on mobile and for rushed users.
3. **No "Use my location" on Party Finder.** Add a geolocation button beside the postcode field; fall back to postcode if denied. Removes the single biggest mobile friction point in venue search.
4. **Two-stage form expectation gap.** Either preview the date/time fields on the homepage, or set expectations ("Next: pick your date & confirm") so the second form doesn't feel like a surprise.

### 🟡 Polish
1. Homepage validation fires one alert per missing field (`index.html:824-826`) — validate all at once with inline highlights.
2. The homepage "Creating…" button (`index.html:830`) disables then waits on a full page navigation; on bad internet it can sit silently. Consider a lightweight transition/spinner or prefetch.
3. "Postcode not recognised" should appear inline under the field, not as an `alert()`.
4. Two equally-weighted primary buttons in the hero — consider making one secondary to guide first-time visitors.

---

### Suggested order to implement
1. Critical #1 (silent guest-load failure) — protects the core guest experience.
2. Medium #1 (contradictory copy) — one-line, removes a perceived dead end.
3. Medium #2 (replace alerts with toasts/inline) — broad mobile + rush win.
4. Medium #3 ("Use my location") — highest-value Party Finder mobile upgrade.
