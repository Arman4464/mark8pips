import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

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
    const { email, password } = req.body;
    
    // Simple hardcoded admin check (replace with proper password hashing)
    if (email === 'mark8pips@gmail.com' && password === 'Sam@00977') {
      
      // Generate JWT token
      const token = jwt.sign(
        { email, role: 'owner' }, 
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );
      
      res.json({ 
        success: true, 
        token,
        user: { email, role: 'owner' }
      });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
