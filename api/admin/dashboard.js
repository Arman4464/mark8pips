export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Import Supabase
  const { createClient } = await import('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (req.method === 'GET') {
    try {
      // Fetch all users from database
      const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Calculate statistics
      const stats = {
        total_users: users.length,
        trial_users: users.filter(u => u.subscription_type.includes('trial')).length,
        paid_users: users.filter(u => !u.subscription_type.includes('trial')).length,
        active_users: users.filter(u => u.status === 'active' || u.status === 'trial').length,
        paused_users: users.filter(u => u.status === 'paused').length,
        pending_approvals: users.filter(u => u.status === 'pending').length
      };

      console.log(`📊 Dashboard: ${users.length} users, ${stats.pending_approvals} pending`);

      res.json({
        success: true,
        users: users,
        stats: stats
      });

    } catch (error) {
      console.error('Dashboard fetch error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch dashboard data',
        error: error.message 
      });
    }
  }

  else if (req.method === 'POST') {
    try {
      const { action, account_number } = req.body;

      if (action === 'approve') {
        // Approve pending user
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30); // 30 days trial

        const { error } = await supabase
          .from('users')
          .update({ 
            status: 'trial',
            expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('account_number', account_number);

        if (error) throw error;
        console.log(`✅ Approved user: ${account_number}`);
        res.json({ success: true, message: 'User approved successfully' });
      }

      else if (action === 'pause') {
        const { error } = await supabase
          .from('users')
          .update({ 
            status: 'paused',
            updated_at: new Date().toISOString()
          })
          .eq('account_number', account_number);

        if (error) throw error;
        console.log(`⏸️ Paused user: ${account_number}`);
        res.json({ success: true, message: 'User paused successfully' });
      }

      else if (action === 'resume') {
        const { error } = await supabase
          .from('users')
          .update({ 
            status: 'active',
            updated_at: new Date().toISOString()
          })
          .eq('account_number', account_number);

        if (error) throw error;
        console.log(`▶️ Resumed user: ${account_number}`);
        res.json({ success: true, message: 'User resumed successfully' });
      }

      else {
        res.status(400).json({ success: false, message: 'Invalid action' });
      }

    } catch (error) {
      console.error('Dashboard action error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Action failed',
        error: error.message 
      });
    }
  }

  else {
    res.status(405).json({ success: false, message: 'Method not allowed' });
  }
}
