import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
  
  try {
    const { license_key } = req.body;
    
    // Get license
    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .select('user_id')
      .eq('license_key', license_key)
      .single();
    
    if (licenseError || !license) {
      return res.status(404).json({ success: false, message: 'License not found' });
    }
    
    // Update user status
    await supabase
      .from('users')
      .update({ status: 'suspended' })
      .eq('id', license.user_id);
    
    // Update license status
    await supabase
      .from('licenses')
      .update({ status: 'revoked' })
      .eq('license_key', license_key);
    
    res.json({ success: true, message: 'License revoked successfully' });
    
  } catch (error) {
    console.error('Revoke license error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}
