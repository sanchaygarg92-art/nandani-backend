// src/routes/users.js
const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// ── GET /users/me ─────────────────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user  = await query('SELECT * FROM users WHERE uid = $1', [req.uid]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    const addrs = await query(
      'SELECT * FROM addresses WHERE user_uid = $1 ORDER BY is_default DESC, created_at DESC',
      [req.uid]
    );
    res.json({ ...user.rows[0], addresses: addrs.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /users/me ─────────────────────────────────────────────
// Update name AND/OR phone — called when user fills in phone after Google signup
router.put('/me', verifyToken, async (req, res) => {
  const { name, phone } = req.body;
  if (!name?.trim() && !phone) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  try {
    // If phone being added — check it's not already taken by another user
    if (phone) {
      const phoneCheck = await query(
        'SELECT uid FROM users WHERE phone = $1 AND uid != $2',
        [phone, req.uid]
      );
      if (phoneCheck.rows.length > 0) {
        return res.status(409).json({
          error: 'PHONE_TAKEN',
          message: `+91${phone} is already linked to another account.`,
        });
      }
    }

    // Build dynamic update
    const updates = [];
    const values  = [];
    let   idx     = 1;

    if (name?.trim()) { updates.push(`name = $${idx++}`);       values.push(name.trim()); }
    if (phone)        { updates.push(`phone = $${idx++}`);      values.push(phone); }
    updates.push(`updated_at = NOW()`);
    values.push(req.uid);

    const result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE uid = $${idx} RETURNING *`,
      values
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /users/me/addresses ───────────────────────────────────
router.get('/me/addresses', verifyToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM addresses WHERE user_uid = $1 ORDER BY is_default DESC, created_at DESC',
      [req.uid]
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /users/me/addresses ──────────────────────────────────
router.post('/me/addresses', verifyToken, async (req, res) => {
  const { address, label, is_default } = req.body;
  if (!address?.trim()) return res.status(400).json({ error: 'Address required' });
  try {
    const exists = await query(
      'SELECT id FROM addresses WHERE user_uid = $1 AND address = $2',
      [req.uid, address.trim()]
    );
    if (exists.rows.length > 0) {
      return res.json({ id: exists.rows[0].id, address: address.trim(), already_exists: true });
    }
    const count = await query('SELECT COUNT(*) FROM addresses WHERE user_uid = $1', [req.uid]);
    if (parseInt(count.rows[0].count) >= 5) {
      await query(
        'DELETE FROM addresses WHERE id = (SELECT id FROM addresses WHERE user_uid = $1 ORDER BY created_at ASC LIMIT 1)',
        [req.uid]
      );
    }
    if (is_default) {
      await query('UPDATE addresses SET is_default = false WHERE user_uid = $1', [req.uid]);
    }
    const result = await query(
      'INSERT INTO addresses (user_uid, address, label, is_default) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.uid, address.trim(), label || 'Saved', is_default || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /users/me/addresses/:id ───────────────────────────────
router.put('/me/addresses/:id', verifyToken, async (req, res) => {
  const { address, label, is_default } = req.body;
  if (!address?.trim()) return res.status(400).json({ error: 'Address required' });
  try {
    const existing = await query(
      'SELECT id FROM addresses WHERE id = $1 AND user_uid = $2',
      [req.params.id, req.uid]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Address not found' });
    }
    if (is_default) {
      await query('UPDATE addresses SET is_default = false WHERE user_uid = $1', [req.uid]);
    }
    const result = await query(
      `UPDATE addresses SET address = $1, label = COALESCE($2, label), is_default = COALESCE($3, is_default)
       WHERE id = $4 AND user_uid = $5 RETURNING *`,
      [address.trim(), label, is_default, req.params.id, req.uid]
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /users/me/addresses/:id ───────────────────────────
router.delete('/me/addresses/:id', verifyToken, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM addresses WHERE id = $1 AND user_uid = $2 RETURNING id',
      [req.params.id, req.uid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Address not found' });
    res.json({ success: true, deleted_id: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: GET /users/all ─────────────────────────────────────
router.get('/all', verifyAdmin, async (req, res) => {
  try {
    const users = await query(
      `SELECT u.*,
        COUNT(DISTINCT o.id)::int AS order_count,
        COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.total ELSE 0 END),0)::int AS total_spent
       FROM users u
       LEFT JOIN orders o ON o.user_uid = u.uid
       GROUP BY u.uid
       ORDER BY u.created_at DESC`
    );
    const result = await Promise.all(users.rows.map(async (user) => {
      const addrs = await query(
        'SELECT id, address, label, is_default FROM addresses WHERE user_uid = $1 ORDER BY is_default DESC',
        [user.uid]
      );
      return { ...user, addresses: addrs.rows };
    }));
    res.json(result);
  } catch (e) {
    console.error('Get all users error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN: GET /users/:uid ────────────────────────────────────
router.get('/:uid', verifyAdmin, async (req, res) => {
  try {
    const user   = await query('SELECT * FROM users WHERE uid = $1', [req.params.uid]);
    const addrs  = await query('SELECT * FROM addresses WHERE user_uid = $1 ORDER BY is_default DESC', [req.params.uid]);
    const orders = await query('SELECT * FROM orders WHERE user_uid = $1 ORDER BY placed_at DESC', [req.params.uid]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ ...user.rows[0], addresses: addrs.rows, orders: orders.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
