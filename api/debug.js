const BASE = "https://tinyinvites.org";

const TESTS = [
  {
    id: "TC01",
    label: "Homepage loads",
    fn: async () => {
      const t0 = Date.now();
      try {
        const res = await fetch(BASE);
        return {
          status: res.ok ? "PASS" : "FAIL",
          notes: `HTTP ${res.status}`,
          time: Date.now() - t0
        };
      } catch (e) {
        return {
          status: "FAIL",
          notes: e.message,
          time: Date.now() - t0
        };
      }
    }
  },

  {
    id: "TC02",
    label: "Create party rejects empty payload",
    fn: async () => {
      const t0 = Date.now();
      try {
        const res = await fetch(`${BASE}/api/create-party`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({})
        });

        return {
          status:
            res.status === 400 || res.status === 422 ? "PASS" : "FAIL",
          notes: `HTTP ${res.status}`,
          time: Date.now() - t0
        };
      } catch (e) {
        return {
          status: "SKIP",
          notes: e.message,
          time: Date.now() - t0
        };
      }
    }
  },

  {
    id: "TC03",
    label: "Invalid email rejected",
    fn: async () => {
      const t0 = Date.now();

      try {
        const res = await fetch(`${BASE}/api/create-party`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            title: "Test",
            hostEmail: "abc@@gmail"
          })
        });

        return {
          status:
            res.status === 400 || res.status === 422 ? "PASS" : "FAIL",
          notes: `HTTP ${res.status}`,
          time: Date.now() - t0
        };
      } catch (e) {
        return {
          status: "SKIP",
          notes: e.message,
          time: Date.now() - t0
        };
      }
    }
  },

  {
    id: "TC04",
    label: "Fake dashboard token blocked",
    fn: async () => {
      const t0 = Date.now();

      try {
        const res = await fetch(`${BASE}/dashboard/fake-token-123`);

        return {
          status:
            [401, 403, 404].includes(res.status) ? "PASS" : "FAIL",
          notes: `HTTP ${res.status}`,
          time: Date.now() - t0
        };
      } catch (e) {
        return {
          status: "SKIP",
          notes: e.message,
          time: Date.now() - t0
        };
      }
    }
  },

  {
    id: "TC05",
    label: "Security headers exist",
    fn: async () => {
      const t0 = Date.now();

      try {
        const res = await fetch(BASE);

        const csp = res.headers.get("content-security-policy");
        const xfo = res.headers.get("x-frame-options");

        const ok = csp || xfo;

        return {
          status: ok ? "PASS" : "WARN",
          notes: ok ? "Headers found" : "Missing security headers",
          time: Date.now() - t0
        };
      } catch (e) {
        return {
          status: "SKIP",
          notes: e.message,
          time: Date.now() - t0
        };
      }
    }
  },

  {
    id: "TC06",
    label: "10 rapid create-party spam test",
    fn: async () => {
      const t0 = Date.now();

      try {
        const requests = [];

        for (let i = 0; i < 10; i++) {
          requests.push(
            fetch(`${BASE}/api/create-party`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                title: `Spam${i}`,
                hostEmail: `spam${i}@test.com`
              })
            })
          );
        }

        const results = await Promise.all(requests);

        const blocked = results.filter(r => r.status === 429).length;

        return {
          status: blocked > 0 ? "PASS" : "WARN",
          notes: `${blocked}/10 blocked`,
          time: Date.now() - t0
        };
      } catch (e) {
        return {
          status: "SKIP",
          notes: e.message,
          time: Date.now() - t0
        };
      }
    }
  }
];

function updateCounters(results) {
  const counts = {
    PASS: 0,
    FAIL: 0,
    WARN: 0,
    SKIP: 0
  };

  results.forEach(r => counts[r.status]++);

  document.getElementById("passCount").textContent = counts.PASS;
  document.getElementById("failCount").textContent = counts.FAIL;
  document.getElementById("warnCount").textContent = counts.WARN;
  document.getElementById("skipCount").textContent = counts.SKIP;
}

function renderRow(test, result) {
  const row = document.createElement("tr");

  row.innerHTML = `
    <td>${test.id}</td>
    <td>${test.label}</td>
    <td><span class="status-badge ${result.status}">${result.status}</span></td>
    <td>${result.notes}</td>
    <td>${result.time}ms</td>
  `;

  document.getElementById("resultsTable").appendChild(row);
}

async function runAllTests() {
  clearResults();

  const results = [];

  for (const test of TESTS) {
    const result = await test.fn();
    results.push(result);
    renderRow(test, result);
    updateCounters(results);
  }
}

function clearResults() {
  document.getElementById("resultsTable").innerHTML = "";

  document.getElementById("passCount").textContent = 0;
  document.getElementById("failCount").textContent = 0;
  document.getElementById("warnCount").textContent = 0;
  document.getElementById("skipCount").textContent = 0;
}
