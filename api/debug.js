import { createClient } from ‘@supabase/supabase-js’;

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
try {
const testPayload = {
party_id:        crypto.randomUUID(),
dashboard_token: crypto.randomUUID(),
child_name:      ‘Test Child’,
age:             ‘5’,
venue:           ‘Test Venue’,
parent_email:    ‘test@test.com’,
photo_url:       null,
special_note:    null,
phone_number:    null,
};

```
console.log('Debug test payload:', JSON.stringify(testPayload));

const { data, error } = await supabase
  .from('parties')
  .insert([testPayload])
  .select();

if (error) {
  console.error('Supabase error:', JSON.stringify(error));
  return res.status(500).json({
    success: false,
    error: error.message,
    details: error,
    payload: testPayload,
  });
}

return res.status(200).json({
  success: true,
  inserted: data,
  payload: testPayload,
});
```

} catch (err) {
return res.status(500).json({
success: false,
error: err.message,
});
}
}