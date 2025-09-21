import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function detectAccountType(accountNumber, serverName, brokerName) {
  // Demo account detection patterns
  const demoPatterns = [
    /demo/i, /test/i, /practice/i, /simulation/i, /contest/i
  ];
  
  // Check server name
  const isDemoByServer = serverName && demoPatterns.some(pattern => pattern.test(serverName));
  
  // Check broker name
  const isDemoByBroker = brokerName && demoPatterns.some(pattern => pattern.test(brokerName));
  
  // Check account number ranges (common demo patterns)
  const isDemoByNumber = (
    (accountNumber >= 50000000 && accountNumber <= 90000000) || // MT5 demo range
    (accountNumber >= 1000000 && accountNumber <= 9999999) ||   // MT4 demo range
    accountNumber > 100000000 // Very high numbers usually demo
  );
  
  if (isDemoByServer || isDemoByBroker || isDemoByNumber) {
    return 'demo';
  }
  
  // Real account indicators
  if (accountNumber < 1000000 || (accountNumber > 10000000 && accountNumber < 50000000)) {
    return 'real';
  }
  
  return 'unknown';
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         'unknown';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
  
  try {
    const { 
      account_number, 
      account_name,
      broker_name, 
      account_balance, 
      ea_name,           // NEW: EA name from MT4/MT5
      ea_version, 
      mt5_build,
      server_name,
      account_currency,
      account_leverage,
      trial_type = 'trial_30'
    } = req.body;
    
    // Input validation
    if (!account_number || !broker_name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required data: account_number and broker_name' 
      });
    }
    
    const clientIP = getClientIP(req);
    const accountType = detectAccountType(account_number, server_name, broker_name);
    const displayName = account_name || `Trader_${account_number}`;
    const eaDisplayName = ea_name || 'Mark8Pips Professional EA';
    
    console.log(`📊 License Request: ${displayName} | Account: ${account_number} (${accountType}) | EA: ${eaDisplayName} | Broker: ${broker_name}`);
    
    // Check if user already exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('account_number', account_number)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows found
      throw fetchError;
    }
    
    if (existingUser) {
      // Update existing user with latest information
      const { error: updateError } = await supabase
        .from('users')
        .update({
          last_seen: new Date().toISOString(),
          account_name: account_name || existingUser.account_name,
          account_balance,
          account_type: accountType !== 'unknown' ? accountType : existingUser.account_type,
          server_name: server_name || existingUser.server_name,
          account_currency: account_currency || existingUser.account_currency,
          account_leverage: account_leverage || existingUser.account_leverage,
          ea_name: ea_name || existingUser.ea_name,
          ea_version: ea_version || existingUser.ea_version,
          mt5_build: mt5_build || existingUser.mt5_build,
          client_ip: clientIP,
          validation_count: (existingUser.validation_count || 0) + 1
        })
        .eq('account_number', account_number);
      
      if (updateError) throw updateError;
      
      // Check license validity
      const now = new Date();
      const expiryDate = new Date(existingUser.expires_at);
      const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      
      if (expiryDate < now) {
        return res.json({
          valid: false,
          message: `❌ License expired ${Math.abs(daysRemaining)} days ago - Contact Mark8Pips to renew`,
          status: 'expired',
          expires_at: existingUser.expires_at,
          account_type: accountType,
          account_name: displayName,
          ea_name: eaDisplayName
        });
      }
      
      if (existingUser.status !== 'active' && existingUser.status !== 'trial') {
        return res.json({
          valid: false,
          message: `❌ License suspended - Contact Mark8Pips support`,
          status: existingUser.status,
          account_type: accountType,
          account_name: displayName,
          ea_name: eaDisplayName
        });
      }
      
      return res.json({
        valid: true,
        status: existingUser.status,
        subscription_type: existingUser.subscription_type,
        expires_at: existingUser.expires_at,
        days_remaining: Math.max(0, daysRemaining),
        message: `✅ Welcome back ${displayName}! ${existingUser.subscription_type} license active for ${eaDisplayName}`,
        account_type: accountType,
        account_name: displayName,
        ea_name: eaDisplayName
      });
      
    } else {
      // Create new user with trial
      const expiryDate = new Date();
      const trialDays = trial_type === 'trial_7' ? 7 : 30;
      expiryDate.setDate(expiryDate.getDate() + trialDays);
      
      console.log(`🆕 Creating new user: ${displayName} with ${trialDays}-day trial for ${eaDisplayName}`);
      
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
          account_number,
          account_name: displayName,
          broker_name,
          account_type: accountType,
          account_balance,
          account_currency: account_currency || 'USD',
          account_leverage,
          server_name,
          ea_name: eaDisplayName,
          ea_version,
          mt5_build,
          subscription_type: trial_type,
          status: 'trial',
          expires_at: expiryDate.toISOString(),
          validation_count: 1,
          client_ip: clientIP
        })
        .select()
        .single();
      
      if (insertError) throw insertError;
      
      // Generate license key
      const license_key = `EA-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      
      // Create license record
      const { error: licenseError } = await supabase
        .from('licenses')
        .insert({
          user_id: newUser.id,
          license_key,
          ea_name: eaDisplayName
        });
      
      if (licenseError) throw licenseError;
      
      console.log(`✅ User created: ID ${newUser.id}, License: ${license_key}`);
      
      return res.json({
        valid: true,
        status: 'trial',
        subscription_type: trial_type,
        expires_at: expiryDate.toISOString(),
        days_remaining: trialDays,
        license_key,
        message: `🎉 Welcome ${displayName}! ${trialDays}-day trial activated for ${eaDisplayName} on your ${accountType} account`,
        account_type: accountType,
        account_name: displayName,
        ea_name: eaDisplayName
      });
    }
    
  } catch (error) {
    console.error('❌ License validation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'License server error. Please try again.',
      valid: false 
    });
  }
}
