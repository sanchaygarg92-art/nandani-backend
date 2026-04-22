// src/routes/auth.js
const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { verifyToken } = require('../middleware/auth');

// ── POST /auth/login ──────────────────────────────────────────
// Called after Firebase OTP or Google verification
// Creates user if new, returns user profile if existing
router.post('/login', verifyToken, async (req, res) => {
  const { uid, phone, email } = req;
  const { name, auth_provider } = req.body;

  try {
    // Check if user exists
    const existing = await query('SELECT * FROM users WHERE uid = $1', [uid]);

    if (existing.rows.length > 0) {
      // Returning user — update last seen, return profile
      const user = existing.rows[0];

      // Get addresses
      const addrs = await query(
        'SELECT * FROM addresses WHERE user_uid = $1 ORDER BY is_default DESC, created_at DESC',
        [uid]
      );

      return res.json({
        isNew: false,
        user: {
          ...user,
          addresses: addrs.rows,
        },
      });
    }

    // ── New user — check phone/email uniqueness ───────────────
    if (phone) {
      const phoneCheck = await query('SELECT uid FROM users WHERE phone = $1 AND uid != $2', [phone, uid]);
      if (phoneCheck.rows.length > 0) {
        return res.status(409).json({
          error: 'ACCOUNT_EXISTS',
          message: `An account with ${phone} already exists. Please sign in instead.`,
        });
      }
    }

    if (email) {
      const emailCheck = await query('SELECT uid FROM users WHERE email = $1 AND uid != $2', [email, uid]);
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({
          error: 'ACCOUNT_EXISTS',
          message: `An account with ${email} already exists. Please sign in instead.`,
        });
      }
    }

    // ── Create new user ───────────────────────────────────────
    const userName = name || (phone ? `User ${phone.slice(-4)}` : 'User');
    const newUser  = await query(
      `INSERT INTO users (uid, name, phone, email, auth_provider)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [uid, userName, phone || null, email || null, auth_provider || 'phone']
    );

    return res.status(201).json({
      isNew: true,
      user: { ...newUser.rows[0], addresses: [] },
    });

  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error', message: e.message });
  }
});

// ── POST /auth/check-phone ────────────────────────────────────
// Check if phone already has an account (before sending OTP)
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
