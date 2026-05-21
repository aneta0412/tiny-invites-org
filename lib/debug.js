/* eslint-disable */
// debug.js — Code review findings for Tiny Invites
// Generated: 2026-05-21
//
// Run with `node debug.js` to print the report, or just read the comments.
// Severity tags: [CRITICAL] [HIGH] [MEDIUM] [LOW] [SUGGESTION]
//
// File references use repo-relative paths (lib/foo.js, api/foo.js, /foo.html).

const FINDINGS = [

  // ════════════════════════════════════════════════════════════════════════
  // CRITICAL — things that break or silently fail in production
  // ════════════════════════════════════════════════════════════════════════

  {
    id: 'C1',
    severity: 'CRITICAL',
    title: 'Cleanup cron is not wired in vercel.json',
    file:  'vercel.json',
    detail: `vercel.json only declares the daily-digest cron. The new
cleanup-inactive-parties cron will never run, so no parties will ever be
auto-deleted, even after 60 days.`,
    fix: `Add a second cron entry:
{
  "crons": [
    { "path": "/api/daily-digest",             "schedule": "0 20 * * *" },
    { "path": "/api/cleanup-inactive-parties", "schedule": "0 3 * * *"  }
  ]
}
And make sure the file lives at api/cleanup-inactive-parties.js (not under
api/cron/). The current import path in the file I wrote — "../lib/..." —
already assumes that location.`,
  },

  {
    id: 'C2',
    severity: 'CRITICAL',
    title: 'party_date is never written, so cleanup falls back to created_at for ALL parties',
    file:  'lib/go-live.js, lib/publish-party.js, lib/confirm-party.js',
    detail: `get-party.js exposes party_date as a public column, but no
endpoint ever writes to it. That means every party in the database has
party_date = NULL. The cleanup cron then falls back to created_at, which
means: a party created today for an event 90 days from now will be deleted
on day 60 — before the party even happens.`,
    fix: `Two options:
  (a) Add party_date to the create / publish flow so the column gets a real
      date, then cleanup uses (party_date + 60d) correctly.
  (b) Change cleanup to only delete when party_date IS NOT NULL AND
      party_date < (now - 60d). Parties without a date are left alone (or
      cleaned up on a much longer fallback like 180 days).
Option (a) is the proper fix; (b) is a one-line safety patch in
cleanup-inactive-parties.js until (a) ships.`,
  },

  {
    id: 'C3',
    severity: 'CRITICAL',
    title: 'publish-party.js and send-guest-confirmation.js send from onboarding@resend.dev',
    file:  'lib/publish-party.js:85, lib/send-guest-confirmation.js:153',
    detail: `Two endpoints use 'Tiny Invites <onboarding@resend.dev>' instead
of the verified domain 'Tiny Invites <hello@tinyinvites.org>' that the rest
of the codebase uses. The resend.dev address is Resend's TEST sender — in
production it only delivers to the account owner's email and is heavily
rate-limited. Guests will silently not receive their confirmations.`,
    fix: `Replace both occurrences with 'Tiny Invites <hello@tinyinvites.org>'.
Grep before merging: grep -rn "onboarding@resend.dev"`,
  },

  // ════════════════════════════════════════════════════════════════════════
  // HIGH — real bugs, not yet on fire
  // ════════════════════════════════════════════════════════════════════════

  {
    id: 'H1',
    severity: 'HIGH',
    title: 'GET /api/party?action=confirm-party can be triggered by email link scanners',
    file:  'lib/confirm-party.js + /confirm.html',
    detail: `confirm-party.js accepts both GET and POST. Outlook/Gmail/Slack
link-preview bots fetch URLs in incoming email — when one of them fetches
your confirm link, the party gets confirmed before the user ever sees the
email. The user then visits the same link and sees the "already confirmed"
state, which is harmless but confusing. Worse: any forwarding or quoting of
the email re-fires the side effect on each scanner pass.`,
    fix: `Make the email link point to /confirm.html?token=... (a static page,
which scanners can fetch safely). The page then POSTs to
/api/party?action=confirm-party with the token in the body. Reject GET on
the API handler. confirm.html already does the fetch — just change the
method to POST and send the token in the body, and change the handler to
reject GET.`,
  },

  {
    id: 'H2',
    severity: 'HIGH',
    title: 'submit-rsvp duplicate check uses guest_name only',
    file:  'lib/submit-rsvp.js:189',
    detail: `The duplicate check is .eq('party_id', party_id).ilike('guest_name', guest_name)
— a case-insensitive name match within a party. Two different people called
"John Smith" cannot both RSVP. The second one gets a silent { duplicate:true }
response and their data is dropped on the floor.`,
    fix: `Either include guest_email in the uniqueness key, or drop the
duplicate-suppression and rely on a "edit my RSVP" flow instead. If you
keep the check, surface duplicate:true clearly in the UI so guests aren't
confused when their RSVP "doesn't go through".`,
  },

  {
    id: 'H3',
    severity: 'HIGH',
    title: '/delete-party.html does not exist — the new email footer link will 404',
    file:  '/delete-party.html (missing)',
    detail: `hostFooter() in lib/send-email.js links to
https://tinyinvites.org/delete-party.html?token=... — but no such page is
in the project. Every host email currently links to a 404.`,
    fix: `Create /delete-party.html. Pattern off /confirm.html: read token
from URL, show "Are you sure? This deletes your party and all RSVPs",
on confirm POST { token, confirmed: true } to
/api/party?action=delete-party, then show success/error state. Until that
page exists, the footer is dead.`,
  },

  {
    id: 'H4',
    severity: 'HIGH',
    title: 'Orphan duplicate router: dashboard-api-0c322cf7.js',
    file:  'api/dashboard-api-0c322cf7.js',
    detail: `Stale duplicate of dashboard-api.js. No "// Updated:" header,
no import path prefixes (../lib/...), looks like a copy left over from a
deploy or rename. If Vercel routes pick it up, requests could land on
either router non-deterministically.`,
    fix: `Delete the file. Confirm dashboard-api.js is the live one (it has
the proper ../lib/ paths and the dated header).`,
  },

  {
    id: 'H5',
    severity: 'HIGH',
    title: 'attending field is stored as both boolean AND "yes"/"no" strings',
    file:  'lib/submit-rsvp.js:213, lib/update-guest.js:80',
    detail: `submit-rsvp inserts the raw request value (boolean from the
form, or the string 'true'/'yes'). update-guest writes the literal strings
'yes' or 'no'. Every read site has to defensively normalise:
  r.attending === true || r.attending === 'true' || r.attending === 'yes'
This pattern appears 6+ times across the codebase and is exactly the kind
of thing that produces a regression the next time someone adds a new
attending value.`,
    fix: `Pick one canonical representation (recommend boolean, since that's
what Postgres prefers for yes/no semantics) and normalise at the boundary
in both submit-rsvp and update-guest. Then strip the defensive normalisation
from the read sites — one source of truth.`,
  },

  // ════════════════════════════════════════════════════════════════════════
  // MEDIUM — bugs you'll hit eventually, or noticeable inconsistency
  // ════════════════════════════════════════════════════════════════════════

  {
    id: 'M1',
    severity: 'MEDIUM',
    title: 'guest_count maximum disagrees between create (30) and edit (60)',
    file:  'lib/submit-rsvp.js:38, lib/update-guest.js:85',
    detail: `submit-rsvp caps guest_count at 30. update-guest allows up to
60. A guest can therefore RSVP for 30, then edit their own response up to
60 — or, more likely, the host edits up to 60 from the dashboard and the
mismatch confuses future maintenance.`,
    fix: `Hoist the cap to a shared constant in a small lib/limits.js (or
similar) and import it in both files.`,
  },

  {
    id: 'M2',
    severity: 'MEDIUM',
    title: 'Timezone drift: setHours(0,0,0,0) is local, not UTC',
    file:  'lib/submit-rsvp.js:239, api/daily-digest.js:26',
    detail: `Both files use new Date(); setHours(0,0,0,0) to mean "start of
today". On Vercel this is UTC today, which lines up with the 20:00 UTC
cron — for now. If you ever deploy to a region with a different server
timezone, or run locally, the "today" boundary in submit-rsvp drifts
relative to the daily-digest cron. That can cause double notifications or
missed digests at the day boundary.`,
    fix: `Use setUTCHours(0,0,0,0) explicitly in both places. One-line
change.`,
  },

  {
    id: 'M3',
    severity: 'MEDIUM',
    title: 'Cleanup deletes silently — host gets no warning, no audit trail',
    file:  'api/cleanup-inactive-parties.js',
    detail: `When a party hits the 60-day threshold and gets deleted, the
host receives no email and there's no soft-delete row. If the host comes
back on day 65 to download their guest list, everything is gone with no
explanation.`,
    fix: `Either:
  (a) Send a "your party will be deleted in 7 days unless you act" email
      at the 53-day mark, with a "keep this party" link that bumps
      party_date or sets a 'preserved' flag.
  (b) Soft-delete: add deleted_at column, hide deleted parties from get-party
      and dashboard, and hard-purge after another 30 days.
(a) is more user-friendly; (b) is safer for "oops I clicked delete".`,
  },

  {
    id: 'M4',
    severity: 'MEDIUM',
    title: 'go-live.js claims the confirm link expires in 24 hours but it does not',
    file:  'lib/go-live.js (email body) + lib/confirm-party.js (no expiry check)',
    detail: `The confirmation email says "This link expires in 24 hours" but
confirm-party.js never checks created_at against the current time. A user
who clicks the link 6 months later will still successfully confirm.`,
    fix: `Either add the check (reject if now - created_at > 24h) or remove
the misleading copy. Adding the check is recommended — a 6-month-old
unconfirmed party shouldn't be revivable.`,
  },

  {
    id: 'M5',
    severity: 'MEDIUM',
    title: 'get-party.js returns party data even when confirmed = false',
    file:  'lib/get-party.js:40',
    detail: `Anyone with a party_id UUID can hit the public get-party
endpoint and see the party even before the host confirms their email.
The host's child name, photo, and phone number become discoverable from
a UUID guess — not realistically brute-forceable, but unnecessary surface.`,
    fix: `Add .eq('confirmed', true) to the query in get-party.js. Returns
404 for unconfirmed parties, which is what the rsvp.html page should be
seeing anyway.`,
  },

  // ════════════════════════════════════════════════════════════════════════
  // LOW — nit-picks, defense in depth
  // ════════════════════════════════════════════════════════════════════════

  {
    id: 'L1',
    severity: 'LOW',
    title: 'isValidUrl accepts any well-formed URL',
    file:  'lib/go-live.js:36',
    detail: `photo_url validation is just "try new URL(val)". So
javascript:alert(1) is rejected (no protocol mismatch caught), but
http://evil.example/track.png is accepted. The photo is rendered in
emails via <img src>, so the email client fetches it — minor pixel-tracking
risk for the host.`,
    fix: `Allow-list http/https only: try { const u = new URL(val); return
['http:','https:'].includes(u.protocol); } catch { return false; }`,
  },

  {
    id: 'L2',
    severity: 'LOW',
    title: 'UUID regex in get-party.js rejects uppercase hex',
    file:  'lib/get-party.js:35',
    detail: `Regex is [0-9a-f] only. crypto.randomUUID() lowercases, so
internally generated UUIDs always match — but if a host pastes a UUID
from somewhere else (or a tool capitalises it), the request 400s instead
of working.`,
    fix: `Add 'i' flag to the regex, or include A-F: /^[0-9a-fA-F]{8}-.../`,
  },

  {
    id: 'L3',
    severity: 'LOW',
    title: 'delete-party leaves no notification to the host',
    file:  'lib/delete-party.js',
    detail: `If someone with the dashboard_token deletes the party (legit
or otherwise — token leaks happen via email forwarding), the host gets
zero notification. A final "your party was deleted" email to the email
on file would close the loop and give the host one last chance to notice
something is off.`,
    fix: `Send a farewell email in deletePartyByToken before the DB delete,
or capture the parent_email before deletion and send after. Don't include
the dashboard_token in this email (the party is gone).`,
  },

  {
    id: 'L4',
    severity: 'LOW',
    title: 'Race condition: go-live can create duplicate parties on double-submit',
    file:  'lib/go-live.js',
    detail: `Fast double-click or network retry inserts two rows for the
same parent_email + child_name. Each gets its own dashboard_token, so the
user receives two confirmation emails and ends up with two parties.`,
    fix: `Add a unique constraint on (parent_email, child_name, created_at-bucket)
in the DB, OR debounce on the client, OR check for an existing unconfirmed
party with the same parent_email + child_name in the last 5 minutes and
return the existing one.`,
  },

  // ════════════════════════════════════════════════════════════════════════
  // SUGGESTIONS — improvements, not bugs
  // ════════════════════════════════════════════════════════════════════════

  {
    id: 'S1',
    severity: 'SUGGESTION',
    title: 'Centralise the "from" address, brand colours, and copy strings',
    detail: `Several files duplicate the colour palette, ordinal() function,
the base() email shell, and the from address. C3 above is a direct
consequence of duplication. Move shared constants and helpers into
lib/email-constants.js and import everywhere. Single source of truth.`,
  },

  {
    id: 'S2',
    severity: 'SUGGESTION',
    title: 'Add a simple integration test for the email pipeline',
    detail: `Most of the bugs above (C3, H1, H3, H5) would have been
caught by a single test that calls each handler with a known good input
and asserts: (a) no exceptions, (b) sendEmail called with expected from
address, (c) HTML contains the host footer iff the recipient is the host.
Doesn't need to actually send mail — mock the resend client.`,
  },

  {
    id: 'S3',
    severity: 'SUGGESTION',
    title: 'Add a "preserve my party" link to the cleanup warning email',
    detail: `Pair with M3. When the 53-day warning goes out, give the host
a one-click "keep this for another 60 days" link that bumps a
preserved_until timestamp. Cheap to implement, dramatically reduces the
chance of an unhappy host coming back to a deleted party.`,
  },

  {
    id: 'S4',
    severity: 'SUGGESTION',
    title: 'Schema doc / migrations folder',
    detail: `Several columns (party_date, confirmed, confirmed_at,
published_at, deleted_at if you adopt soft-delete) are referenced in code
but their schema is implicit. Add a /migrations folder or a /schema.sql
file so the expected shape of parties and guest_responses is checked in
to source control.`,
  },

];

// ─── Reporter ──────────────────────────────────────────────────────────────
// Run `node debug.js` to print a grouped report.

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'SUGGESTION'];
const SEVERITY_ICON  = {
  CRITICAL:   '🔴',
  HIGH:       '🟠',
  MEDIUM:     '🟡',
  LOW:        '🔵',
  SUGGESTION: '💡',
};

function printReport() {
  const grouped = {};
  for (const f of FINDINGS) {
    (grouped[f.severity] = grouped[f.severity] || []).push(f);
  }
  for (const sev of SEVERITY_ORDER) {
    const items = grouped[sev] || [];
    if (!items.length) continue;
    console.log(`\n${SEVERITY_ICON[sev]}  ${sev} (${items.length})`);
    console.log('─'.repeat(60));
    for (const f of items) {
      console.log(`\n[${f.id}] ${f.title}`);
      if (f.file) console.log(`     ${f.file}`);
      if (f.detail) console.log(`\n  ${f.detail.trim().replace(/\n/g, '\n  ')}`);
      if (f.fix)    console.log(`\n  Fix:\n  ${f.fix.trim().replace(/\n/g, '\n  ')}`);
    }
  }
  const total = FINDINGS.length;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Total findings: ${total}`);
  console.log(`  Critical: ${(grouped.CRITICAL  ||[]).length}`);
  console.log(`  High:     ${(grouped.HIGH      ||[]).length}`);
  console.log(`  Medium:   ${(grouped.MEDIUM    ||[]).length}`);
  console.log(`  Low:      ${(grouped.LOW       ||[]).length}`);
  console.log(`  Suggest:  ${(grouped.SUGGESTION||[]).length}`);
}

// Print when run directly (node debug.js)
if (import.meta.url === `file://${process.argv[1]}`) {
  printReport();
}

export { FINDINGS, printReport };
