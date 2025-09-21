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
    const { user_email, ea_name, account_numbers, subscription_type } = req.body;
    
    // Generate unique license key
    const license_key = `EA-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    // Calculate expiration
    const now = new Date();
    let expires_at;
    
    switch (subscription_type) {
      case 'yearly':
        expires_at = new Date(now.setFullYear(now.getFullYear() + 1));
        break;
      case 'lifetime':
        expires_at = new Date('2099-12-31');
        break;
      default: // monthly
        expires_at = new Date(now.setMonth(now.getMonth() + 1));
    }
    
    // Create user
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        email: user_email,
        subscription_type,
        expires_at: expires_at.toISOString(),
        status: 'active'
      })
      .select()
      .single();
    
    if (userError) throw userError;
    
    // Create license
    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .insert({
        license_key,
        user_id: user.id,
        ea_name,
        account_numbers: account_numbers.map(num => parseInt(num)),
        validation_count: 0,
        status: 'active'
      })
      .select()
      .single();
    
    if (licenseError) throw licenseError;
    
    res.json({ 
      success: true, 
      license_key,
      expires_at: expires_at.toISOString(),
      user_id: user.id
    });
    
  } catch (error) {
    console.error('Create license error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}
