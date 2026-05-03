// src/routes/auth.js
const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { verifyToken } = require('../middleware/auth');
const admin = require('../firebase');

// ── POST /auth/send-otp ───────────────────────────────────────
// Uses Firebase Admin SDK to send OTP — works for ALL real numbers,
// no reCAPTCHA needed. Blaze plan required on Firebase project.
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  try {
    // Firebase Admin SDK: generate a sign-in link / session
    // We use the REST API on behalf of the server using the service account
    const { GoogleAuth } = require('google-auth-library');

    // Get an access token from the service account
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/identitytoolkit'],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    // Call Firebase Identity Toolkit with server auth (bypasses reCAPTCHA)
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${process.env.FIREBASE_API_KEY || 'AIzaSyC1SlAhWTTxH_WZAZ7hYBeqTdFLTq4bixw'}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          phoneNumber: phone,
          // Server-side call with OAuth2 token bypasses reCAPTCHA requirement
        }),
      }
    );

    const data = await response.json();
    if (data.error) {
      console.error('Firebase send-otp error:', data.error);
      return res.status(400).json({ error: data.error.message });
    }

    console.log(`OTP sent to ${phone} via Admin SDK`);
    return res.json({ sessionInfo: data.sessionInfo, success: true });
  } catch (e) {
    console.error('send-otp error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /auth/login ──────────────────────────────────────────
router.post('/login', verifyToken, async (req, res) => {
  const { uid, phone, email } = req;
  const { name, auth_provider } = req.body;
  try {
    const existing = await query('SELECT * FROM users WHERE uid = $1', [uid]);
    if (existing.rows.length > 0) {
      const user  = existing.rows[0];
      const addrs = await query('SELECT * FROM addresses WHERE user_uid = $1 ORDER BY is_default DESC, created_at DESC', [uid]);
      return res.json({ isNew: false, user: { ...user, addresses: addrs.rows } });
    }
    if (phone) {
      const check = await query('SELECT uid, name FROM users WHERE phone = $1', [phone]);
      if (check.rows.length > 0) {
        const addrs = await query('SELECT * FROM addresses WHERE user_uid = $1', [check.rows[0].uid]);
        return res.json({ isNew: false, user: { ...check.rows[0], addresses: addrs.rows } });
      }
    }
    if (email) {
      const check = await query('SELECT uid, name FROM users WHERE email = $1', [email.toLowerCase()]);
      if (check.rows.length > 0) {
        const addrs = await query('SELECT * FROM addresses WHERE user_uid = $1', [check.rows[0].uid]);
        return res.json({ isNew: false, user: { ...check.rows[0], addresses: addrs.rows } });
      }
    }
    const userName = (name && name.trim()) || (phone ? `User ${phone.slice(-4)}` : 'User');
    const newUser  = await query(
      `INSERT INTO users (uid, name, phone, email, auth_provider)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [uid, userName, phone || null, email?.toLowerCase() || null, auth_provider || 'phone']
    );
    return res.status(201).json({ isNew: true, user: { ...newUser.rows[0], addresses: [] } });
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Server error', message: e.message });
  }
});

// ── POST /auth/upsert ─────────────────────────────────────────
router.post('/upsert', async (req, res) => {
  const { uid, name, phone, email, auth_provider } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid required' });
  try {
    const result = await query(
      `INSERT INTO users (uid, name, phone, email, auth_provider)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (uid) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, users.name),
         updated_at = NOW()
       RETURNING *`,
      [uid, name || 'User', phone || null, email?.toLowerCase() || null, auth_provider || 'phone']
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /auth/check-email ────────────────────────────────────
router.post('/check-email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const result = await query('SELECT uid, name FROM users WHERE email = $1', [email.toLowerCase()]);
    res.json({ exists: result.rows.length > 0, name: result.rows[0]?.name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
