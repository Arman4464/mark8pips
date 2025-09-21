export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    // Import Supabase
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      account_number,
      account_name,
      broker_name,
      server_name,
      account_balance,
      account_currency,
      account_leverage,
      ea_name,
      ea_version
    } = req.body;

    console.log('📝 License request for account:', account_number, 'EA:', ea_name);

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('account_number', account_number)
      .single();

    let user;
    const now = new Date();

    if (existingUser) {
      // Update existing user
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          account_name: account_name,
          broker_name: broker_name,
          server_name: server_name,
          account_balance: account_balance,
          account_currency: account_currency,
          account_leverage: account_leverage,
          ea_name: ea_name,
          ea_version: ea_version,
          last_seen: now.toISOString(),
          validation_count: (existingUser.validation_count || 0) + 1,
          client_ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown'
        })
        .eq('account_number', account_number)
        .select()
        .single();

      if (updateError) throw updateError;
      user = updatedUser;
    } else {
      // Create new user with PENDING status for first-time approval
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now

      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{
          account_number: account_number,
          account_name: account_name,
          broker_name: broker_name,
          server_name: server_name,
          account_balance: account_balance,
          account_currency: account_currency,
          account_leverage: account_leverage,
          ea_name: ea_name,
          ea_version: ea_version,
          status: 'pending', // CHANGED TO PENDING FOR APPROVAL
          subscription_type: 'trial_30',
          expires_at: expiresAt.toISOString(),
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
          last_seen: now.toISOString(),
          validation_count: 1,
          client_ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown'
        }])
        .select()
        .single();

      if (insertError) throw insertError;
      user = newUser;
    }

    // Calculate days remaining
    const expiresAt = new Date(user.expires_at);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));

    // Check status and return appropriate response
    if (user.status === 'pending') {
      return res.json({
        valid: false,
        status: user.status,
        message: `⏳ Your account is pending approval. Please contact Mark8Pips admin for activation.`,
        subscription_type: user.subscription_type,
        account_type: user.account_type || 'unknown',
        account_name: user.account_name,
        ea_name: user.ea_name,
        days_remaining: 0
      });
    }

    if (user.status === 'paused') {
      return res.json({
        valid: false,
        status: user.status,
        message: `⏸️ Your EA has been paused by administrator. Contact Mark8Pips support.`,
        subscription_type: user.subscription_type,
        account_type: user.account_type || 'unknown',
        account_name: user.account_name,
        ea_name: user.ea_name,
        days_remaining: daysRemaining
      });
    }

    if (user.status === 'suspended') {
      return res.json({
        valid: false,
        status: user.status,
        message: `🚫 License suspended - Contact Mark8Pips support`,
        subscription_type: user.subscription_type,
        account_type: user.account_type || 'unknown',
        account_name: user.account_name,
        ea_name: user.ea_name,
        days_remaining: 0
      });
    }

    if (daysRemaining <= 0 && user.subscription_type !== 'lifetime') {
      // Update status to expired
      await supabase
        .from('users')
        .update({ status: 'expired' })
        .eq('account_number', account_number);

      return res.json({
        valid: false,
        status: 'expired',
        message: `❌ License expired ${Math.abs(daysRemaining)} days ago - Contact Mark8Pips to renew`,
        subscription_type: user.subscription_type,
        account_type: user.account_type || 'unknown',
        account_name: user.account_name,
        ea_name: user.ea_name,
        days_remaining: daysRemaining
      });
    }

    // Valid license
    return res.json({
      valid: true,
      status: user.status,
      subscription_type: user.subscription_type,
      expires_at: user.expires_at,
      days_remaining: daysRemaining,
      message: `✅ Welcome back ${user.account_name}! ${user.subscription_type} license active for ${user.ea_name}`,
      account_type: user.account_type || 'unknown',
      account_name: user.account_name,
      ea_name: user.ea_name
    });

  } catch (error) {
    console.error('License validation error:', error);
    return res.status(500).json({
      valid: false,
      status: 'error',
      message: 'License validation failed - Please try again later',
      error: error.message
    });
  }
}
