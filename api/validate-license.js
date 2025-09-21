import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ valid: false, message: 'Method not allowed' });
  }
  
  try {
    const { license_key, account_number } = req.body;
    
    if (!license_key || !account_number) {
      return res.status(400).json({ valid: false, message: 'Missing required fields' });
    }
    
    // Get license with user data
    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .select(`
        *,
        users (*)
      `)
      .eq('license_key', license_key)
      .single();
    
    if (licenseError || !license) {
      return res.status(404).json({ valid: false, message: 'License not found' });
    }
    
    const user = license.users;
    
    // Check status
    if (user.status !== 'active') {
      return res.status(403).json({ valid: false, message: 'License suspended' });
    }
    
    // Check expiration
    const now = new Date();
    const expiryDate = new Date(user.expires_at);
    if (expiryDate < now) {
      return res.status(403).json({ valid: false, message: 'License expired' });
    }
    
    // Check account number
    if (!license.account_numbers.includes(parseInt(account_number))) {
      return res.status(403).json({ valid: false, message: 'Account not authorized' });
    }
    
    // Update validation count
    await supabase
      .from('licenses')
      .update({
        last_validation: new Date().toISOString(),
        validation_count: license.validation_count + 1
      })
      .eq('license_key', license_key);
    
    return res.json({
      valid: true,
      expires_at: user.expires_at,
      ea_name: license.ea_name,
      days_remaining: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))
    });
    
  } catch (error) {
    console.error('Validation error:', error);
    return res.status(500).json({ valid: false, message: 'Internal server error' });
  }
}
