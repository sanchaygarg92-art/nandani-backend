// src/routes/auth.js
const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { verifyToken } = require('../middleware/auth');

// ── POST /auth/login ──────────────────────────────────────────
// Called after Firebase OTP/Google — creates or fetches user
router.post('/login', verifyToken, async (req, res) => {
  const { uid, phone, email } = req;
  const { name, auth_provider } = req.body;

  try {
    // Check if user exists
    const existing = await query('SELECT * FROM users WHERE uid = $1', [uid]);

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      const addrs = await query(
        'SELECT * FROM addresses WHERE user_uid = $1 ORDER BY is_default DESC, created_at DESC',
        [uid]
      );
      return res.json({ isNew: false, user: { ...user, addresses: addrs.rows } });
    }

    // Check uniqueness
    if (phone) {
      const check = await query('SELECT uid FROM users WHERE phone = $1', [phone]);
      if (check.rows.length > 0) {
        // Return existing user if same phone
        const existingByPhone = await query('SELECT * FROM users WHERE phone = $1', [phone]);
        const addrs = await query('SELECT * FROM addresses WHERE user_uid = $1', [existingByPhone.rows[0].uid]);
        return res.json({ isNew: false, user: { ...existingByPhone.rows[0], addresses: addrs.rows } });
      }
    }

    // Create new user
    const userName = (name && name.trim()) || (phone ? `User ${phone.slice(-4)}` : 'User');
    const newUser  = await query(
      `INSERT INTO users (uid, name, phone, email, auth_provider)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [uid, userName, phone || null, email || null, auth_provider || 'phone']
    );

    return res.status(201).json({ isNew: true, user: { ...newUser.rows[0], addresses: [] } });

  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Server error', message: e.message });
  }
});

// ── POST /auth/upsert ─────────────────────────────────────────
// Upsert user — used when Firebase token not available (demo mode)
router.post('/upsert', async (req, res) => {
  const { uid, name, phone, email, auth_provider } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid required' });

  try {
    const result = await query(
      `INSERT INTO users (uid, name, phone, email, auth_provider)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (uid) DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = NOW()
       RETURNING *`,
      [uid, name || 'User', phone || null, email || null, auth_provider || 'phone']
    );
    const addrs = await query('SELECT * FROM addresses WHERE user_uid = $1', [uid]);
    res.json({ user: { ...result.rows[0], addresses: addrs.rows } });
  } catch (e) {
    console.error('Upsert error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /auth/check-phone ────────────────────────────────────
router.post('/check-phone', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  try {
    const result = await query('SELECT uid, name FROM users WHERE phone = $1', [phone]);
    res.json({ exists: result.rows.length > 0, name: result.rows[0]?.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /auth/check-email ────────────────────────────────────
router.post('/check-email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const result = await query('SELECT uid, name FROM users WHERE email = $1', [email.toLowerCase()]);
    res.json({ exists: result.rows.length > 0, name: result.rows[0]?.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
