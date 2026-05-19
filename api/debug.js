const BASE = window.location.origin;

const TESTS = [
  {
    id: "TC01",
    label: "Homepage loads",
    fn: async function () {
      const t0 = Date.now();
      try {
        const res = await fetch(BASE);
        return {
          status: res.ok ? "PASS" : "FAIL",
          notes: "HTTP " + res.status,
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
    fn: async function () {
      const t0 = Date.now();
      try {
        const res = await fetch(BASE + "/api/create-party", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({})
        });

        return {
          status: (res.status === 400 || res.status === 422) ? "PASS" : "FAIL",
          notes: "HTTP " + res.status,
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
    label: "Fake dashboard token blocked",
    fn: async function () {
      const t0 = Date.now();
      try {
        const res = await fetch(BASE + "/dashboard/fake-token-123");

        return {
          status: [401, 403, 404].includes(res.status) ? "PASS" : "FAIL",
          notes: "HTTP " + res.status,
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

function renderRow(test, result) {
  const row = document.createElement("tr");

  row.innerHTML =
    "<td>" + test.id + "</td>" +
    "<td>" + test.label + "</td>" +
    "<td><span class='status-badge " + result.status + "'>" + result.status + "</span></td>" +
    "<td>" + result.notes + "</td>" +
    "<td>" + result.time + "ms</td>";

  document.getElementById("resultsTable").appendChild(row);
}

function updateCounters(results) {
  let pass = 0, fail = 0, warn = 0, skip = 0;

  results.forEach(function (r) {
    if (r.status === "PASS") pass++;
    if (r.status === "FAIL") fail++;
    if (r.status === "WARN") warn++;
    if (r.status === "SKIP") skip++;
  });

  document.getElementById("passCount").textContent = pass;
  document.getElementById("failCount").textContent = fail;
  document.getElementById("warnCount").textContent = warn;
  document.getElementById("skipCount").textContent = skip;
}

window.runAllTests = async function () {
  window.clearResults();

  const results = [];

  for (const test of TESTS) {
    const result = await test.fn();
    results.push(result);
    renderRow(test, result);
    updateCounters(results);
  }
};

window.clearResults = function () {
  document.getElementById("resultsTable").innerHTML = "";

  document.getElementById("passCount").textContent = 0;
  document.getElementById("failCount").textContent = 0;
  document.getElementById("warnCount").textContent = 0;
  document.getElementById("skipCount").textContent = 0;
};
