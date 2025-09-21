import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function verifyToken(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Verify admin authentication
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  try {
    if (req.method === 'GET') {
      // Get dashboard statistics with enhanced details
      const { data: users } = await supabase
        .from('users')
        .select('*')
        .order('first_seen', { ascending: false });
      
      const now = new Date();
      const stats = {
        total_users: users?.length || 0,
        trial_7_users: users?.filter(u => u.subscription_type === 'trial_7').length || 0,
        trial_30_users: users?.filter(u => u.subscription_type === 'trial_30').length || 0,
        monthly_users: users?.filter(u => u.subscription_type === 'monthly').length || 0,
        yearly_users: users?.filter(u => u.subscription_type === 'yearly').length || 0,
        lifetime_users: users?.filter(u => u.subscription_type === 'lifetime').length || 0,
        active_users: users?.filter(u => u.status === 'active' || u.status === 'trial').length || 0,
        suspended_users: users?.filter(u => u.status === 'suspended').length || 0,
        expired_users: users?.filter(u => new Date(u.expires_at) < now).length || 0,
        expiring_soon: users?.filter(u => {
          const daysLeft = Math.ceil((new Date(u.expires_at) - now) / (1000 * 60 * 60 * 24));
          return daysLeft > 0 && daysLeft <= 7;
        }).length || 0,
        total_revenue: {
          monthly: users?.filter(u => u.subscription_type === 'monthly').length * 29,
          yearly: users?.filter(u => u.subscription_type === 'yearly').length * 290,
          lifetime: users?.filter(u => u.subscription_type === 'lifetime').length * 999,
          total: users?.filter(u => u.subscription_type === 'monthly').length * 29 +
                 users?.filter(u => u.subscription_type === 'yearly').length * 290 +
                 users?.filter(u => u.subscription_type === 'lifetime').length * 999
        }
      };
      
      // Get recent activity
      const { data: recentUsers } = await supabase
        .from('users')
        .select('*')
        .order('last_seen', { ascending: false })
        .limit(10);
      
      res.json({ success: true, users, stats, recent_activity: recentUsers });
    }
    
    if (req.method === 'POST') {
      const { action, account_number, subscription_type, months, days } = req.body;
      
      if (action === 'upgrade') {
        // Upgrade user subscription
        const now = new Date();
        let newExpiry;
        
        switch (subscription_type) {
          case 'monthly':
            newExpiry = new Date(now.setMonth(now.getMonth() + 1));
            break;
          case 'yearly':
            newExpiry = new Date(now.setFullYear(now.getFullYear() + 1));
            break;
          case 'lifetime':
            newExpiry = new Date('2099-12-31');
            break;
          case 'trial_7':
            newExpiry = new Date(now.setDate(now.getDate() + 7));
            break;
          case 'trial_30':
            newExpiry = new Date(now.setDate(now.getDate() + 30));
            break;
          default:
            newExpiry = new Date(now.setMonth(now.getMonth() + 1));
        }
        
        await supabase
          .from('users')
          .update({
            subscription_type,
            status: subscription_type.includes('trial') ? 'trial' : 'active',
            expires_at: newExpiry.toISOString()
          })
          .eq('account_number', account_number);
        
        // Log admin activity
        await supabase
          .from('admin_activity')
          .insert({
            admin_email: user.email,
            action: 'upgrade_user',
            target_account: account_number,
            details: { new_plan: subscription_type, expires_at: newExpiry.toISOString() }
          });
        
        res.json({ 
          success: true, 
          message: `User upgraded to ${subscription_type} plan successfully!`,
          new_expires_at: newExpiry.toISOString() 
        });
      }
      
      if (action === 'extend') {
        // Get current user data
        const { data: userToExtend } = await supabase
          .from('users')
          .select('expires_at')
          .eq('account_number', account_number)
          .single();
        
        if (!userToExtend) {
          return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        // Extend from current expiry date OR from now if expired
        const currentExpiry = new Date(userToExtend.expires_at);
        const now = new Date();
        const baseDate = currentExpiry > now ? currentExpiry : now;
        let newExpiry;
        
        if (days) {
          newExpiry = new Date(baseDate);
          newExpiry.setDate(baseDate.getDate() + parseInt(days));
        } else if (months) {
          newExpiry = new Date(baseDate);
          newExpiry.setMonth(baseDate.getMonth() + parseInt(months));
        } else {
          return res.status(400).json({ success: false, message: 'Please specify days or months to extend' });
        }
        
        await supabase
          .from('users')
          .update({ 
            expires_at: newExpiry.toISOString(),
            status: 'active' // Reactivate if was expired
          })
          .eq('account_number', account_number);
        
        // Log admin activity
        const extensionText = days ? `${days} days` : `${months} months`;
        await supabase
          .from('admin_activity')
          .insert({
            admin_email: user.email,
            action: 'extend_license',
            target_account: account_number,
            details: { extension: extensionText, new_expires_at: newExpiry.toISOString() }
          });
        
        res.json({ 
          success: true, 
          message: `License extended by ${extensionText} successfully!`,
          new_expires_at: newExpiry.toISOString()
        });
      }
      
      if (action === 'suspend') {
        await supabase
          .from('users')
          .update({ status: 'suspended' })
          .eq('account_number', account_number);
        
        // Log admin activity
        await supabase
          .from('admin_activity')
          .insert({
            admin_email: user.email,
            action: 'suspend_user',
            target_account: account_number,
            details: { reason: 'Manual suspension by admin' }
          });
        
        res.json({ success: true, message: 'User suspended successfully' });
      }
      
      if (action === 'reactivate') {
        await supabase
          .from('users')
          .update({ status: 'active' })
          .eq('account_number', account_number);
        
        // Log admin activity
        await supabase
          .from('admin_activity')
          .insert({
            admin_email: user.email,
            action: 'reactivate_user',
            target_account: account_number,
            details: { reason: 'Reactivated by admin' }
          });
        
        res.json({ success: true, message: 'User reactivated successfully' });
      }
    }
    
  } catch (error) {
    console.error('Dashboard API error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
// Add these new actions to your existing switch statement

if (action === 'pause') {
  await supabase
    .from('users')
    .update({ status: 'paused' })
    .eq('account_number', account_number);
  
  res.json({ success: true, message: 'User paused successfully' });
}

if (action === 'resume') {
  await supabase
    .from('users')
    .update({ status: 'active' })
    .eq('account_number', account_number);
  
  res.json({ success: true, message: 'User resumed successfully' });
}

if (action === 'delete') {
  await supabase
    .from('users')
    .delete()
    .eq('account_number', account_number);
  
  res.json({ success: true, message: 'User deleted permanently' });
}
