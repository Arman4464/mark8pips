import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
  
  try {
    const { license } = req.query;
    
    const { data: licenseData, error: licenseError } = await supabase
      .from('licenses')
      .select(`
        *,
        users (*)
      `)
      .eq('license_key', license)
      .single();
    
    if (licenseError || !licenseData) {
      return res.status(404).json({ success: false, message: 'License not found' });
    }
    
    res.json({
      success: true,
      license: {
        ...licenseData,
        user: licenseData.users
      }
    });
    
  } catch (error) {
    console.error('Get license error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}
