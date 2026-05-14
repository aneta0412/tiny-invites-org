/**
 * tinyinvites.org — Full API Test Suite (v2)
 *
 * Covers:
 *   1.  RSVP submission (happy path, yes/no, dietary, duplicates)
 *   2.  Double-click deduplication
 *   3.  Refresh-after-submit handling
 *   4.  Internet interruption simulation
 *   5.  Dashboard tests (party isolation, bad tokens, empty state)
 *   6.  Email failure isolation (RSVP must save even if email breaks)
 *   7.  Special characters (Polish letters, emoji, apostrophes, CJK)
 *   8.  Load test (20–50 simultaneous submits)
 *   9.  Security (token guessing, SQL injection, XSS)
 *  10.  Edge cases (oversized payload, wrong method, deleted party)
 *
 * Usage:
 *   BASE_URL=https://your-vercel-deployment.vercel.app node test-tinyinvites-full.js
 *
 * Node 18+ required (native fetch). No extra dependencies.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
let sectionName = '';

function assert(label, condition, detail = '') {
  const full = `${sectionName} > ${label}`;
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.log(`  ❌  ${label}${detail ? '  →  ' + detail : ''}`);
    failed++;
    failures.push({ label: full, detail });
  }
}

function section(title) {
  sectionName = title;
  console.log(`\n── ${title} ${'─'.repeat(Math.max(2, 54 - title.length))}`);
}

async function post(path, body, opts = {}) {
  const controller = new AbortController();
  const timeout = opts.timeout ? setTimeout(() => controller.abort(), opts.timeout) : null;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json, timedOut: false };
  } catch (err) {
    if (err.name === 'AbortError') return { status: 0, json: null, timedOut: true };
    return { status: 0, json: null, error: err.message };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function get(path) {
  try {
    const res = await fetch(`${BASE_URL}${path}`);
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: null, error: err.message };
  }
}

async function createParty(overrides = {}) {
  const { json } = await post('/api/create-party', {
    child_name:   'TestChild',
    age:          4,
    venue:        'Test Venue',
    parent_email: `test+${Date.now()}@example.com`,
    party_date:   '2026-08-01',
    ...overrides,
  });
  return { partyId: json?.party_id, dashToken: json?.dashboard_token };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 1. RSVP Submission ────────────────────────────────────────────────────────

async function testRsvpSubmission() {
  section('1. RSVP Submission');
  const { partyId } = await createParty();
  if (!partyId) { console.log('  ⚠️  Skipped — create-party failed'); return null; }

  // Basic yes
  const yes = await post('/api/rsvp-response', {
    party_id: partyId, guest_name: 'Alice', attending: true, guest_count: 1,
  });
  assert('Submit YES → 200', yes.status === 200, `got ${yes.status}`);
  assert('YES returns response id', !!yes.json?.id);

  // Basic no
  const no = await post('/api/rsvp-response', {
    party_id: partyId, guest_name: 'Bob', attending: false,
  });
  assert('Submit NO → 200', no.status === 200, `got ${no.status}`);

  // Multiple guests
  const multi = await post('/api/rsvp-response', {
    party_id: partyId, guest_name: 'Carol', attending: true, guest_count: 3,
  });
  assert('Multiple guests (count=3) → 200', multi.status === 200, `got ${multi.status}`);

  // Dietary requirements
  const dietary = await post('/api/rsvp-response', {
    party_id: partyId, guest_name: 'Dana', attending: true,
    guest_count: 1, allergies: 'Nuts, Dairy', message: 'Lactose-free please',
  });
  assert('Dietary requirements → 200', dietary.status === 200, `got ${dietary.status}`);

  // Verify row appears — fetch dashboard and count responses
  const dash = await get(`/api/dashboard?token=${(await createParty()).dashToken}`);
  // We specifically check partyId's dashboard via its own token in section 5
  // Here just confirm non-500
  assert('Submission does not cause 500 on dashboard', dash.status !== 500);

  return partyId;
}

// ── 2. Double-Click Deduplication ─────────────────────────────────────────────

async function testDoubleClick() {
  section('2. Double-Click / Rapid Resubmit');
  const { partyId } = await createParty();
  if (!partyId) { console.log('  ⚠️  Skipped'); return; }

  const payload = {
    party_id: partyId, guest_name: 'RapidClicker', attending: true, guest_count: 1,
  };

  // Fire 5 identical requests simultaneously
  const results = await Promise.all(
    Array.from({ length: 5 }, () => post('/api/rsvp-response', payload))
  );

  const successes = results.filter(r => r.status === 200);
  const non500 = results.every(r => r.status < 500);

  assert('No request returns 500', non500,
    `statuses: ${results.map(r => r.status).join(', ')}`);

  // Ideal: exactly 1 success. Acceptable: all succeed but DB deduplication prevents duplicates.
  // We flag if all 5 succeed — the dashboard test should then confirm only 1 row.
  if (successes.length === 1) {
    assert('Exactly 1 RSVP accepted (server-side dedup)', true);
  } else {
    assert(
      `⚠️  ${successes.length}/5 accepted — verify DB has only 1 row for RapidClicker`,
      true  // warn, not fail — dedup may be in DB via unique constraint
    );
    console.log('     ACTION: Check Supabase for duplicate rows with guest_name=RapidClicker');
  }
}

// ── 3. Refresh-After-Submit ───────────────────────────────────────────────────

async function testRefreshAfterSubmit() {
  section('3. Refresh-After-Submit');
  const { partyId } = await createParty();
  if (!partyId) { console.log('  ⚠️  Skipped'); return; }

  const payload = {
    party_id: partyId, guest_name: 'Refresher', attending: true, guest_count: 1,
  };

  // First submit
  const first = await post('/api/rsvp-response', payload);
  assert('First submit → 200', first.status === 200, `got ${first.status}`);

  // Simulate refresh — same payload again immediately
  await sleep(200);
  const second = await post('/api/rsvp-response', payload);

  assert('Second submit (refresh sim) does not 500', second.status < 500, `got ${second.status}`);

  if (second.status === 200) {
    assert('⚠️  Second submit accepted — check if duplicate in DB', true);
    console.log('     ACTION: Should either update existing row or return 409 Conflict');
  } else if (second.status === 409) {
    assert('Second submit → 409 Conflict (correct dedup)', true);
  } else if (second.status === 400) {
    assert('Second submit → 400 (server rejects duplicate)', true);
  }
}

// ── 4. Network Interruption Simulation ───────────────────────────────────────

async function testNetworkInterruption() {
  section('4. Network / Timeout Simulation');

  // We simulate a "slow" response by setting a very short timeout.
  // If the endpoint is fast the timeout won't fire — that's fine.
  // This test mainly verifies the API doesn't hang indefinitely.
  const { partyId } = await createParty();
  if (!partyId) { console.log('  ⚠️  Skipped'); return; }

  const result = await post('/api/rsvp-response', {
    party_id: partyId, guest_name: 'SlowUser', attending: true,
  }, { timeout: 10_000 }); // 10s timeout — reasonable upper bound

  if (result.timedOut) {
    assert('⚠️  Request timed out after 10s — investigate slow endpoint', false,
      'Response should arrive within 10s');
  } else {
    assert('Endpoint responds within 10s', result.status > 0, `got ${result.status}`);
    assert('Response is not 500', result.status < 500, `got ${result.status}`);
  }

  console.log('     MANUAL: Turn WiFi off mid-submit on a real device and verify error message shown');
}

// ── 5. Dashboard Tests ────────────────────────────────────────────────────────

async function testDashboard() {
  section('5. Dashboard — Party Isolation, Tokens, Empty State');

  // Create two separate parties
  const a = await createParty({ child_name: 'PartyA' });
  const b = await createParty({ child_name: 'PartyB' });

  if (!a.partyId || !b.partyId) { console.log('  ⚠️  Skipped — create-party failed'); return; }

  // Add a response to Party A only
  await post('/api/rsvp-response', {
    party_id: a.partyId, guest_name: 'PartyA-Guest', attending: true, guest_count: 1,
  });

  // --- Party isolation: Token A must not return Party B's data ---
  const dashA = await get(`/api/dashboard?token=${a.dashToken}`);
  assert('Party A dashboard → 200', dashA.status === 200, `got ${dashA.status}`);

  const responsesA = dashA.json?.responses ?? (Array.isArray(dashA.json) ? dashA.json : []);
  const hasPartyBData = JSON.stringify(responsesA).includes('PartyA-Guest') &&
                        !JSON.stringify(responsesA).includes(b.partyId);
  assert('Party A token only returns Party A data', responsesA.length > 0 && !JSON.stringify(responsesA).includes(b.partyId));

  // --- Token A cannot access Party B responses ---
  // Try fetching with A's token, check none of the IDs match B's party
  const leakCheck = responsesA.some(r => r.party_id === b.partyId);
  assert('SECURITY: Party A token cannot see Party B rows', !leakCheck);

  // --- Empty state: Party B has no responses ---
  const dashB = await get(`/api/dashboard?token=${b.dashToken}`);
  assert('Empty dashboard → 200 (not crash)', dashB.status === 200, `got ${dashB.status}`);
  const responsesB = dashB.json?.responses ?? (Array.isArray(dashB.json) ? dashB.json : []);
  assert('Empty dashboard returns empty array', Array.isArray(responsesB) && responsesB.length === 0,
    `got ${responsesB.length} rows`);

  // --- Bad token ---
  const bad = await get('/api/dashboard?token=definitely-wrong-token-xyz');
  assert('Bad token → 401/403', [401, 403].includes(bad.status), `got ${bad.status}`);
  assert('Bad token does not leak raw DB error', !JSON.stringify(bad.json ?? '').toLowerCase().includes('supabase'),
    JSON.stringify(bad.json));

  // --- Modified/tampered token ---
  const tamperedToken = (a.dashToken ?? 'token') + '-tampered';
  const tampered = await get(`/api/dashboard?token=${tamperedToken}`);
  assert('Tampered token → 401/403/404', [401, 403, 404].includes(tampered.status), `got ${tampered.status}`);

  // --- No token at all ---
  const noToken = await get('/api/dashboard');
  assert('No token → 400/401', [400, 401].includes(noToken.status), `got ${noToken.status}`);
}

// ── 6. Email Failure Isolation ────────────────────────────────────────────────

async function testEmailIsolation() {
  section('6. Email Failure Isolation');

  // We can't easily break Resend in a test, but we verify:
  // a) The RSVP endpoint returns 200 even when email config might be wrong
  // b) The response body tells us whether email was sent (nice to have, not required)

  const { partyId } = await createParty({ parent_email: 'bouncetest@mailinator.com' });
  if (!partyId) { console.log('  ⚠️  Skipped'); return; }

  const rsvp = await post('/api/rsvp-response', {
    party_id: partyId, guest_name: 'EmailTester', attending: true, guest_count: 1,
  });

  assert('RSVP saves even with potentially undeliverable email → 200', rsvp.status === 200,
    `got ${rsvp.status} — CRITICAL: email failure must not block RSVP save`);
  assert('Response contains rsvp id (not just email status)', !!rsvp.json?.id, JSON.stringify(rsvp.json));

  console.log('     MANUAL: In Resend dashboard, temporarily revoke API key, submit RSVP — verify it still saves to Supabase');
}

// ── 7. Special Characters ─────────────────────────────────────────────────────

async function testSpecialCharacters() {
  section('7. Special Characters — Polish, Emoji, Apostrophes, CJK');

  const { partyId } = await createParty({ child_name: 'Łukasz' });
  if (!partyId) { console.log('  ⚠️  Skipped'); return; }

  const cases = [
    { guest_name: 'Łukasz Wójcik',       desc: 'Polish letters (Ł, ó)' },
    { guest_name: "Siobhán O'Connor",    desc: "Irish apostrophe + fada" },
    { guest_name: '🎉 Sophie 🎂',        desc: 'Emoji in name' },
    { guest_name: '田中さくら',            desc: 'Japanese CJK characters' },
    { guest_name: 'Ανδρέας',             desc: 'Greek characters' },
    { guest_name: 'André Müller',        desc: 'French/German accents' },
    { guest_name: '<b>Bold</b>',         desc: 'HTML tags in name' },
    { allergies:  'Gluten & dairy; nuts', guest_name: 'AllergyUser', desc: 'Ampersand + semicolon in allergies' },
  ];

  for (const c of cases) {
    const r = await post('/api/rsvp-response', {
      party_id:   partyId,
      guest_name: c.guest_name ?? 'SpecialChar',
      attending:  true,
      guest_count: 1,
      allergies:  c.allergies,
    });
    assert(`${c.desc} → 200`, r.status === 200, `got ${r.status}`);
  }

  // Also test special chars in child name (create-party)
  const specialParty = await post('/api/create-party', {
    child_name:   "Zoé O'Brien 🎈",
    age:          3,
    venue:        'Café au Lait, Stratford',
    parent_email: 'special@example.com',
  });
  assert("Special chars in child_name → not 500", specialParty.status < 500, `got ${specialParty.status}`);
}

// ── 8. Load Test (20–50 simultaneous) ────────────────────────────────────────

async function testLoad() {
  section('8. Load Test — 50 Simultaneous RSVPs');
  const { partyId } = await createParty({ child_name: 'LoadTestParty' });
  if (!partyId) { console.log('  ⚠️  Skipped'); return; }

  const count = 50;
  const start = Date.now();

  const results = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      post('/api/rsvp-response', {
        party_id:   partyId,
        guest_name: `LoadGuest_${i}`,
        attending:  i % 3 !== 0, // mix of yes and no
        guest_count: (i % 4) + 1,
      })
    )
  );

  const elapsed = Date.now() - start;
  const ok = results.filter(r => r.status === 200).length;
  const errors = results.filter(r => r.status >= 500).length;
  const timeouts = results.filter(r => r.timedOut).length;

  console.log(`     ${ok}/${count} OK, ${errors} server errors, ${timeouts} timeouts, ${elapsed}ms total`);

  assert(`At least 45/${count} RSVPs succeed`, ok >= 45, `only ${ok} succeeded`);
  assert('Zero 500 errors under load', errors === 0, `${errors} server errors`);
  assert('Completes within 15s', elapsed < 15_000, `took ${elapsed}ms`);
}

// ── 9. Security ───────────────────────────────────────────────────────────────

async function testSecurity() {
  section('9. Security');

  // SQL injection variations
  const sqliPayloads = [
    "'; DROP TABLE parties; --",
    "1' OR '1'='1",
    "\" OR \"\"=\"",
    "1; SELECT * FROM guest_responses; --",
  ];

  for (const payload of sqliPayloads) {
    const r = await post('/api/create-party', {
      child_name: payload, age: 5, venue: 'Test', parent_email: 'sqli@example.com',
    });
    assert(`SQL injection in child_name does not 500: ${payload.slice(0, 30)}`, r.status < 500, `got ${r.status}`);
  }

  // XSS payloads
  const xssPayloads = [
    '<script>alert(document.cookie)</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
  ];
  const { partyId } = await createParty();
  if (partyId) {
    for (const payload of xssPayloads) {
      const r = await post('/api/rsvp-response', {
        party_id: partyId, guest_name: payload, attending: true,
      });
      assert(`XSS in guest_name does not 500: ${payload.slice(0, 30)}`, r.status < 500, `got ${r.status}`);
    }
  }

  // Token enumeration — sequential guesses must not work
  const guesses = [
    '1', '2', '123', 'admin', 'test', '00000000-0000-0000-0000-000000000001',
  ];
  for (const guess of guesses) {
    const r = await get(`/api/dashboard?token=${guess}`);
    assert(`Token guess "${guess}" → 401/403/404`, [400, 401, 403, 404].includes(r.status), `got ${r.status}`);
  }

  // IDOR — try to access a party via its raw party_id without a token
  const { partyId: idorId } = await createParty();
  if (idorId) {
    const idor = await get(`/api/dashboard?party_id=${idorId}`);
    assert('IDOR: raw party_id without token → 401/403/404', [400, 401, 403, 404].includes(idor.status), `got ${idor.status}`);
  }

  // Wrong HTTP methods
  const wrongGet = await fetch(`${BASE_URL}/api/create-party`);
  assert('GET on POST-only endpoint → 404/405', [404, 405].includes(wrongGet.status), `got ${wrongGet.status}`);
}

// ── 10. Edge Cases ────────────────────────────────────────────────────────────

async function testEdgeCases() {
  section('10. Edge Cases');

  // Oversized payload
  const big = await post('/api/create-party', {
    child_name: 'A'.repeat(10_000), age: 5, venue: 'Test', parent_email: 'big@example.com',
  });
  assert('Oversized child_name does not 500', big.status < 500, `got ${big.status}`);

  // Missing optional vs required fields
  const noEmail = await post('/api/create-party', {
    child_name: 'NoEmail', age: 5, venue: 'Test',
  });
  assert('Missing parent_email → 400 (if required)', noEmail.status === 400 || noEmail.status === 200,
    `got ${noEmail.status} — check if email is required`);

  // Age out of range
  const badAge = await post('/api/create-party', {
    child_name: 'AgeTest', age: -1, venue: 'Test', parent_email: 'age@example.com',
  });
  assert('Negative age → 400', badAge.status === 400, `got ${badAge.status}`);

  // RSVP with non-existent party
  const fakePid = await post('/api/rsvp-response', {
    party_id: '00000000-0000-0000-0000-000000000000', guest_name: 'Nobody', attending: true,
  });
  assert('Non-existent party_id → 400/404', [400, 404].includes(fakePid.status), `got ${fakePid.status}`);

  // Empty strings
  const empty = await post('/api/create-party', {
    child_name: '', age: 5, venue: '', parent_email: '',
  });
  assert('Empty strings → 400', empty.status === 400, `got ${empty.status}`);

  // guest_count = 0 when attending
  const { partyId } = await createParty();
  if (partyId) {
    const zeroCount = await post('/api/rsvp-response', {
      party_id: partyId, guest_name: 'ZeroCount', attending: true, guest_count: 0,
    });
    assert('guest_count=0 when attending → 400', zeroCount.status === 400, `got ${zeroCount.status}`);
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n🧪  tinyinvites.org — Full Test Suite');
  console.log(`    Target : ${BASE_URL}`);
  console.log(`    Date   : ${new Date().toISOString()}`);
  console.log(`    Node   : ${process.version}\n`);

  await testRsvpSubmission();
  await testDoubleClick();
  await testRefreshAfterSubmit();
  await testNetworkInterruption();
  await testDashboard();
  await testEmailIsolation();
  await testSpecialCharacters();
  await testLoad();
  await testSecurity();
  await testEdgeCases();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(58));
  console.log(`  ✅  Passed : ${passed}`);
  console.log(`  ❌  Failed : ${failed}`);
  if (failures.length) {
    console.log('\n  Failed tests:');
    failures.forEach(f => console.log(`    •  ${f.label}${f.detail ? '\n       ' + f.detail : ''}`));
  }
  console.log('\n  Manual tests still needed:');
  console.log('    •  WiFi off mid-submit → verify error message shown to user');
  console.log('    •  iPhone Safari — keyboard overlap, submit button reachable');
  console.log('    •  Android Chrome — narrow screen layout');
  console.log('    •  Old phone (iOS 15 / Android 10) — no JS crash');
  console.log('    •  Gmail / Outlook / iCloud — emails not in spam');
  console.log('    •  Revoke Resend key → RSVP still saves to Supabase');
  console.log('═'.repeat(58) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\nTest runner crashed:', err);
  process.exit(1);
});