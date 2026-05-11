// src/routes/auth.js
const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { verifyToken } = require('../middleware/auth');

// ── In-memory OTP store ───────────────────────────────────────
const otpStore = new Map();
const FAST2SMS_KEY = process.env.FAST2SMS_API_KEY;

// ── POST /auth/send-otp ───────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const cleaned = phone.replace(/^\+91/, '').replace(/\D/g, '');
  if (cleaned.length !== 10) {
    return res.status(400).json({ error: 'Invalid phone number. Must be 10 digits.' });
  }

  // Rate limit: max 3 OTPs per 10 minutes
  const existing = otpStore.get(cleaned);
  if (existing && existing.attempts >= 3 && existing.expiresAt > Date.now()) {
    return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });
  }

  const otp       = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000;

  otpStore.set(cleaned, {
    otp, expiresAt,
    attempts: (existing?.attempts || 0) + 1,
  });

  try {
    const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        'authorization': FAST2SMS_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        route:   'q',
        message: `Your Nandani Organic OTP is ${otp}. Valid for 10 minutes. Do not share with anyone.`,
        numbers: cleaned,
      }),
    });

    const text = await response.text();
    console.log('Fast2SMS response:', text);

    let data;
    try { data = JSON.parse(text); }
    catch (e) {
      return res.status(500).json({ error: 'SMS service error. Please try again.' });
    }

    if (!data.return) {
      const errMsg = Array.isArray(data.message)
        ? data.message.join(', ')
        : (typeof data.message === 'string' ? data.message : 'Failed to send OTP');
      console.error('Fast2SMS failed:', errMsg);
      return res.status(500).json({ error: errMsg });
    }

    console.log(`OTP ${otp} sent to ${cleaned}`);
    const sessionInfo = Buffer.from(`${cleaned}:${expiresAt}`).toString('base64');
    return res.json({ sessionInfo, success: true });

  } catch (e) {
    console.error('Fast2SMS error:', e.message);
    return res.status(500).json({ error: 'Could not send OTP. Please try again.' });
  }
});

// ── POST /auth/verify-otp ─────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

  const cleaned = phone.replace(/^\+91/, '').replace(/\D/g, '');
  const stored  = otpStore.get(cleaned);

  if (!stored) {
    return res.status(400).json({ error: 'No OTP sent to this number. Please request again.' });
  }
  if (stored.expiresAt < Date.now()) {
    otpStore.delete(cleaned);
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }
  if (stored.otp !== String(otp).trim()) {
    return res.status(400).json({ error: 'Invalid OTP. Please check and try again.' });
  }

  otpStore.delete(cleaned);

  try {
    const admin     = require('../firebase');
    const fullPhone = `+91${cleaned}`;
    let firebaseUser;

    try {
      firebaseUser = await admin.auth().getUserByPhoneNumber(fullPhone);
    } catch (e) {
      firebaseUser = await admin.auth().createUser({ phoneNumber: fullPhone });
    }

    const customToken = await admin.auth().createCustomToken(firebaseUser.uid);
    console.log(`OTP verified for ${fullPhone}, uid: ${firebaseUser.uid}`);

    return res.json({
      success: true,
      uid:     firebaseUser.uid,
      customToken,
      phone:   fullPhone,
    });

  } catch (e) {
    console.error('Firebase verify error:', e.message);
    return res.status(500).json({ error: 'Authentication failed. Please try again.' });
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
