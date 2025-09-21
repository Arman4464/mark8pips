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
  if (req.method !== 'POST') return res.status(405).json({ success: false });
  
  try {
    const { 
      account_number, 
      broker_name, 
      account_balance, 
      ea_version, 
      mt5_build,
      trial_type = 'trial_30' // Default 30-day, can be 'trial_7' or 'trial_30'
    } = req.body;
    
    if (!account_number || !broker_name) {
      return res.status(400).json({ success: false, message: 'Missing required data' });
    }
    
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('account_number', account_number)
      .single();
    
    if (existingUser) {
      // Update last seen and validation count
      await supabase
        .from('users')
        .update({
          last_seen: new Date().toISOString(),
          account_balance,
          validation_count: existingUser.validation_count + 1
        })
        .eq('account_number', account_number);
      
      // Check if license is valid
      const now = new Date();
      const expiryDate = new Date(existingUser.expires_at);
      
      if (expiryDate < now) {
        return res.json({
          valid: false,
          message: 'Trial period expired - Contact Mark8Pips to upgrade',
          status: 'expired',
          expires_at: existingUser.expires_at
        });
      }
      
      if (existingUser.status !== 'active' && existingUser.status !== 'trial') {
        return res.json({
          valid: false,
          message: 'License suspended - Contact Mark8Pips support',
          status: existingUser.status
        });
      }
      
      return res.json({
        valid: true,
        status: existingUser.status,
        subscription_type: existingUser.subscription_type,
        expires_at: existingUser.expires_at,
        days_remaining: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)),
        message: `Welcome back! ${existingUser.subscription_type} license active`
      });
    } else {
      // Create new user with configurable trial period
      const expiryDate = new Date();
      const trialDays = trial_type === 'trial_7' ? 7 : 30;
      expiryDate.setDate(expiryDate.getDate() + trialDays);
      
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          account_number,
          broker_name,
          account_balance,
          ea_version,
          mt5_build,
          subscription_type: trial_type,
          status: 'trial',
          expires_at: expiryDate.toISOString(),
          validation_count: 1
        })
        .select()
        .single();
      
      // Generate license key
      const license_key = `EA-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      
      // Create license record
      await supabase
        .from('licenses')
        .insert({
          user_id: newUser.id,
          license_key,
          ea_name: 'Mark8Pips Professional EA'
        });
      
      return res.json({
        valid: true,
        status: 'trial',
        subscription_type: trial_type,
        expires_at: expiryDate.toISOString(),
        days_remaining: trialDays,
        license_key,
        message: `Welcome! ${trialDays}-day trial activated`
      });
    }
    
  } catch (error) {
    console.error('Auto-register error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
