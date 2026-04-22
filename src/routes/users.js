// src/routes/users.js
const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// ── GET /users/me ─────────────────────────────────────────────
// Get current user's profile + addresses
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await query('SELECT * FROM users WHERE uid = $1', [req.uid]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

    const addrs = await query(
      'SELECT * FROM addresses WHERE user_uid = $1 ORDER BY is_default DESC, created_at DESC',
      [req.uid]
    );

    res.json({ ...user.rows[0], addresses: addrs.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /users/me ─────────────────────────────────────────────
// Update name
router.put('/me', verifyToken, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const result = await query(
      'UPDATE users SET name = $1, updated_at = NOW() WHERE uid = $2 RETURNING *',
      [name.trim(), req.uid]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /users/me/addresses ───────────────────────────────────
router.get('/me/addresses', verifyToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM addresses WHERE user_uid = $1 ORDER BY is_default DESC, created_at DESC',
      [req.uid]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /users/me/addresses ──────────────────────────────────
// Add a new address (max 5 per user)
router.post('/me/addresses', verifyToken, async (req, res) => {
  const { address, label, is_default } = req.body;
  if (!address?.trim()) return res.status(400).json({ error: 'Address required' });

  try {
    // Check if already exists
    const exists = await query(
      'SELECT id FROM addresses WHERE user_uid = $1 AND address = $2',
      [req.uid, address.trim()]
    );
    if (exists.rows.length > 0) {
      return res.json({ message: 'Address already saved', id: exists.rows[0].id });
    }

    // Max 5 addresses
    const count = await query('SELECT COUNT(*) FROM addresses WHERE user_uid = $1', [req.uid]);
    if (parseInt(count.rows[0].count) >= 5) {
      // Remove oldest
      await query(
        'DELETE FROM addresses WHERE id = (SELECT id FROM addresses WHERE user_uid = $1 ORDER BY created_at ASC LIMIT 1)',
        [req.uid]
      );
    }

    // If setting as default, unset others
    if (is_default) {
      await query('UPDATE addresses SET is_default = false WHERE user_uid = $1', [req.uid]);
    }

    const result = await query(
      'INSERT INTO addresses (user_uid, address, label, is_default) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.uid, address.trim(), label || 'Home', is_default || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /users/me/addresses/:id ───────────────────────────
router.delete('/me/addresses/:id', verifyToken, async (req, res) => {
  try {
    await query('DELETE FROM addresses WHERE id = $1 AND user_uid = $2', [req.params.id, req.uid]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN: GET /users/all ─────────────────────────────────────
router.get('/all', verifyAdmin, async (req, res) => {
  try {
    const users = await query(
      `SELECT u.*,
        COUNT(DISTINCT o.id) AS order_count,
        COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total ELSE 0 END), 0) AS total_spent
       FROM users u
       LEFT JOIN orders o ON o.user_uid = u.uid
       GROUP BY u.uid
       ORDER BY u.created_at DESC`
    );

    // Get addresses for each user
    const result = await Promise.all(
      users.rows.map(async (user) => {
        const addrs = await query(
          'SELECT address, label, is_default FROM addresses WHERE user_uid = $1 ORDER BY is_default DESC',
          [user.uid]
        );
        return { ...user, addresses: addrs.rows };
      })
    );

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN: GET /users/:uid ────────────────────────────────────
router.get('/:uid', verifyAdmin, async (req, res) => {
  try {
    const user    = await query('SELECT * FROM users WHERE uid = $1', [req.params.uid]);
    const addrs   = await query('SELECT * FROM addresses WHERE user_uid = $1', [req.params.uid]);
    const orders  = await query('SELECT * FROM orders WHERE user_uid = $1 ORDER BY placed_at DESC', [req.params.uid]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ ...user.rows[0], addresses: addrs.rows, orders: orders.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
