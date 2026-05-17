// create-party.js
// Generates party_id + dashboard_token and returns them.
// No Supabase insert here — that happens in go-live.js when the host confirms.

export default async function handler(req, res) {
if (req.method !== ‘POST’) {
return res.status(405).json({ error: ‘Method not allowed’ });
}

try {
const { child_name } = req.body;

```
if (!child_name) {
  return res.status(400).json({ error: 'Missing child_name' });
}

const party_id        = crypto.randomUUID();
const dashboard_token = crypto.randomUUID();

return res.status(200).json({
  success:         true,
  party_id,
  dashboard_token,
});
```

} catch (err) {
console.error(‘create-party error:’, err);
return res.status(500).json({ error: err.message });
}
}