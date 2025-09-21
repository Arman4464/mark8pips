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
      const now = new Date();
      const stats = {
        total_users: users.length,
        trial_users: users.filter(u => u.subscription_type.includes('trial')).length,
        paid_users: users.filter(u => !u.subscription_type.includes('trial')).length,
        active_users: users.filter(u => u.status === 'active' || u.status === 'trial').length,
        paused_users: users.filter(u => u.status === 'paused').length,
        pending_approvals: users.filter(u => u.status === 'pending').length
      };

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
      const { action, account_number, subscription_type, days, months } = req.body;

      if (action === 'upgrade') {
        let expiresAt = new Date();
        
        // Calculate expiration based on subscription type
        if (subscription_type === 'trial_7') {
          expiresAt.setDate(expiresAt.getDate() + 7);
        } else if (subscription_type === 'trial_30') {
          expiresAt.setDate(expiresAt.getDate() + 30);
        } else if (subscription_type === 'monthly') {
          expiresAt.setMonth(expiresAt.getMonth() + 1);
        } else if (subscription_type === 'yearly') {
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        } else if (subscription_type === 'lifetime') {
          expiresAt.setFullYear(expiresAt.getFullYear() + 100); // 100 years
        }

        const { error } = await supabase
          .from('users')
          .update({ 
            subscription_type: subscription_type,
            expires_at: expiresAt.toISOString(),
            status: subscription_type.includes('trial') ? 'trial' : 'active',
            updated_at: new Date().toISOString()
          })
          .eq('account_number', account_number);

        if (error) throw error;
        res.json({ success: true, message: 'User upgraded successfully' });
      }

      else if (action === 'extend') {
        const { data: user } = await supabase
          .from('users')
          .select('expires_at')
          .eq('account_number', account_number)
          .single();

        let newExpiresAt = new Date(user.expires_at);
        
        if (days) {
          newExpiresAt.setDate(newExpiresAt.getDate() + parseInt(days));
        }
        if (months) {
          newExpiresAt.setMonth(newExpiresAt.getMonth() + parseInt(months));
        }

        const { error } = await supabase
          .from('users')
          .update({ 
            expires_at: newExpiresAt.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('account_number', account_number);

        if (error) throw error;
        res.json({ success: true, message: 'License extended successfully' });
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
        res.json({ success: true, message: 'User resumed successfully' });
      }

      else if (action === 'suspend') {
        const { error } = await supabase
          .from('users')
          .update({ 
            status: 'suspended',
            updated_at: new Date().toISOString()
          })
          .eq('account_number', account_number);

        if (error) throw error;
        res.json({ success: true, message: 'User suspended successfully' });
      }

      else if (action === 'delete') {
        const { error } = await supabase
          .from('users')
          .delete()
          .eq('account_number', account_number);

        if (error) throw error;
        res.json({ success: true, message: 'User deleted successfully' });
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
