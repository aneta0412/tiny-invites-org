const { createClient } = require(’@supabase/supabase-js’);

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
try {
const party_id        = crypto.randomUUID();
const dashboard_token = crypto.randomUUID();

```
const testPayload = {
  party_id,
  dashboard_token,
  child_name:   'Test Child',
  age:          '5',
  venue:        'Test Venue',
  parent_email: 'test@test.com',
  photo_url:    null,
  special_note: null,
  phone_number: null,
};

const { data, error } = await supabase
  .from('parties')
  .insert([testPayload])
  .select();

if (error) {
  return res.status(500).json({
    success: false,
    error:   error.message,
    details: error,
  });
}

// Clean up test row
await supabase.from('parties').delete().eq('party_id', party_id);

return res.status(200).json({
  success: true,
  message: 'Insert worked fine — Supabase is healthy',
});
```

} catch (err) {
return res.status(500).json({
success: false,
error:   err.message,
stack:   err.stack,
});
}
};