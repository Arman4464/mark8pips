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
    const { license_key, months } = req.body;
    
    // Get license and user
    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .select(`*, users (*)`)
      .eq('license_key', license_key)
      .single();
    
    if (licenseError || !license) {
      return res.status(404).json({ success: false, message: 'License not found' });
    }
    
    const currentExpiry = new Date(license.users.expires_at);
    const newExpiry = new Date(currentExpiry.setMonth(currentExpiry.getMonth() + parseInt(months)));
    
    // Update user expiration
    const { error: updateError } = await supabase
      .from('users')
      .update({ expires_at: newExpiry.toISOString() })
      .eq('id', license.user_id);
    
    if (updateError) throw updateError;
    
    res.json({ 
      success: true, 
      license_key,
      new_expires_at: newExpiry.toISOString() 
    });
    
  } catch (error) {
    console.error('Extend license error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}
