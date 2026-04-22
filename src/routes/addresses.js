// src/routes/addresses.js
const express = require('express');
const router  = express.Router();
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const VALID_CITIES = ['panchkula', 'chandigarh', 'zirakpur'];

// ─────────────────────────────────────────────────────────────
// GET /addresses
// Get all addresses for current user
// ─────────────────────────────────────────────────────────────
router.get('/', verifyToken, async (req, res) => {
  try {
    const user = await query('SELECT uid FROM users WHERE firebase_uid=$1', [req.uid]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

    const result = await query(
      'SELECT * FROM addresses WHERE user_uid=$1 ORDER BY is_default DESC, created_at DESC',
      [user.rows[0].uid]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /addresses
// Add a new address
// Body: { label, full_address, city }
// ─────────────────────────────────────────────────────────────
router.post('/', verifyToken, async (req, res) => {
  try {
    const { label, full_address, city } = req.body;
    if (!full_address) return res.status(400).json({ error: 'full_address is required' });

    // Validate city
    const cityLower = (city || '').toLowerCase();
    const detectedCity = VALID_CITIES.find(c => full_address.toLowerCase().includes(c)) || cityLower;
    if (!VALID_CITIES.includes(detectedCity)) {
      return res.status(400).json({
        error:   'INVALID_CITY',
        message: 'We deliver only to Panchkula, Chandigarh, and Zirakpur.',
      });
    }

    const user = await query('SELECT uid FROM users WHERE firebase_uid=$1', [req.uid]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    const userUid = user.rows[0].uid;

    // Check duplicate
    const dup = await query(
      'SELECT id FROM addresses WHERE user_uid=$1 AND full_address=$2',
      [userUid, full_address]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Address already saved' });
    }

    // If first address, make it default
    const count = await query('SELECT COUNT(*) FROM addresses WHERE user_uid=$1', [userUid]);
    const isDefault = parseInt(count.rows[0].count) === 0;

    const result = await query(
      `INSERT INTO addresses (user_uid, label, full_address, city, is_default)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [userUid, label || 'Home', full_address, detectedCity, isDefault]
    );
    res.status(201).json({ success: true, address: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /addresses/:id
// ─────────────────────────────────────────────────────────────
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const user = await query('SELECT uid FROM users WHERE firebase_uid=$1', [req.uid]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

    await query(
      'DELETE FROM addresses WHERE id=$1 AND user_uid=$2',
      [req.params.id, user.rows[0].uid]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /addresses/:id/default
// Set as default address
// ─────────────────────────────────────────────────────────────
router.put('/:id/default', verifyToken, async (req, res) => {
  try {
    const user = await query('SELECT uid FROM users WHERE firebase_uid=$1', [req.uid]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    const userUid = user.rows[0].uid;

    await query('UPDATE addresses SET is_default=false WHERE user_uid=$1', [userUid]);
    await query('UPDATE addresses SET is_default=true  WHERE id=$1 AND user_uid=$2', [req.params.id, userUid]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
