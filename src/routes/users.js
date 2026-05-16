// src/routes/users.js
const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// Helper: build full address string from parts
function buildFullAddress({ house_no, area, city, pincode }) {
  return [house_no, area, city, pincode].filter(Boolean).join(', ');
}

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
router.put('/me', verifyToken, async (req, res) => {
  const { name, phone } = req.body;
  if (!name?.trim() && !phone) return res.status(400).json({ error: 'Nothing to update' });
  try {
    if (phone) {
      const phoneCheck = await query('SELECT uid FROM users WHERE phone = $1 AND uid != $2', [phone, req.uid]);
      if (phoneCheck.rows.length > 0) return res.status(409).json({ error: 'PHONE_TAKEN', message: `+91${phone} is already linked to another account.` });
    }
    const updates = []; const values = []; let idx = 1;
    if (name?.trim()) { updates.push(`name = $${idx++}`); values.push(name.trim()); }
    if (phone)        { updates.push(`phone = $${idx++}`); values.push(phone); }
    updates.push(`updated_at = NOW()`);
    values.push(req.uid);
    const result = await query(`UPDATE users SET ${updates.join(', ')} WHERE uid = $${idx} RETURNING *`, values);
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
// Accepts both structured fields AND legacy plain address string
router.post('/me/addresses', verifyToken, async (req, res) => {
  const { address, label, is_default, house_no, area, city, pincode } = req.body;

  // Build address string from structured fields if provided
  const fullAddress = (house_no || area || city || pincode)
    ? buildFullAddress({ house_no, area, city, pincode })
    : address;

  if (!fullAddress?.trim()) return res.status(400).json({ error: 'Address required' });

  try {
    // Check duplicate
    const exists = await query('SELECT id FROM addresses WHERE user_uid = $1 AND address = $2', [req.uid, fullAddress.trim()]);
    if (exists.rows.length > 0) {
      return res.json({ ...exists.rows[0], address: fullAddress.trim(), already_exists: true });
    }

    // Max 5 addresses — remove oldest if exceeded
    const count = await query('SELECT COUNT(*) FROM addresses WHERE user_uid = $1', [req.uid]);
    if (parseInt(count.rows[0].count) >= 5) {
      await query('DELETE FROM addresses WHERE id = (SELECT id FROM addresses WHERE user_uid = $1 ORDER BY created_at ASC LIMIT 1)', [req.uid]);
    }

    // If setting as default, unset others
    if (is_default) await query('UPDATE addresses SET is_default = false WHERE user_uid = $1', [req.uid]);

    // Check if this is the first address → auto set as default
    const countAfter = await query('SELECT COUNT(*) FROM addresses WHERE user_uid = $1', [req.uid]);
    const shouldBeDefault = is_default || parseInt(countAfter.rows[0].count) === 0;

    const result = await query(
      `INSERT INTO addresses (user_uid, address, label, is_default, house_no, area, city, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.uid, fullAddress.trim(), label || 'Home', shouldBeDefault, house_no||null, area||null, city||null, pincode||null]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    // If structured columns don't exist yet, fall back to basic insert
    if (e.message.includes('column') && e.message.includes('does not exist')) {
      try {
        const exists = await query('SELECT id FROM addresses WHERE user_uid = $1 AND address = $2', [req.uid, fullAddress.trim()]);
        if (exists.rows.length > 0) return res.json({ ...exists.rows[0], already_exists: true });
        if (is_default) await query('UPDATE addresses SET is_default = false WHERE user_uid = $1', [req.uid]);
        const result = await query(
          'INSERT INTO addresses (user_uid, address, label, is_default) VALUES ($1,$2,$3,$4) RETURNING *',
          [req.uid, fullAddress.trim(), label||'Home', is_default||false]
        );
        res.status(201).json(result.rows[0]);
      } catch (e2) { res.status(500).json({ error: e2.message }); }
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// ── PUT /users/me/addresses/:id ───────────────────────────────
router.put('/me/addresses/:id', verifyToken, async (req, res) => {
  const { address, label, is_default, house_no, area, city, pincode } = req.body;
  const fullAddress = (house_no || area || city || pincode)
    ? buildFullAddress({ house_no, area, city, pincode })
    : address;
  if (!fullAddress?.trim()) return res.status(400).json({ error: 'Address required' });
  try {
    const existing = await query('SELECT id FROM addresses WHERE id = $1 AND user_uid = $2', [req.params.id, req.uid]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Address not found' });
    if (is_default) await query('UPDATE addresses SET is_default = false WHERE user_uid = $1', [req.uid]);
    const result = await query(
      `UPDATE addresses SET address=$1, label=COALESCE($2,label), is_default=COALESCE($3,is_default),
       house_no=$4, area=$5, city=$6, pincode=$7
       WHERE id=$8 AND user_uid=$9 RETURNING *`,
      [fullAddress.trim(), label, is_default, house_no||null, area||null, city||null, pincode||null, req.params.id, req.uid]
    ).catch(() =>
      // Fallback if new columns don't exist
      query('UPDATE addresses SET address=$1, label=COALESCE($2,label), is_default=COALESCE($3,is_default) WHERE id=$4 AND user_uid=$5 RETURNING *',
        [fullAddress.trim(), label, is_default, req.params.id, req.uid])
    );
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /users/me/addresses/:id ───────────────────────────
router.delete('/me/addresses/:id', verifyToken, async (req, res) => {
  try {
    const result = await query('DELETE FROM addresses WHERE id=$1 AND user_uid=$2 RETURNING id', [req.params.id, req.uid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Address not found' });
    res.json({ success:true, deleted_id: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: GET /users/all ─────────────────────────────────────
router.get('/all', verifyAdmin, async (req, res) => {
  try {
    const users = await query(
      `SELECT u.*, COUNT(DISTINCT o.id)::int AS order_count,
        COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.total ELSE 0 END),0)::int AS total_spent
       FROM users u LEFT JOIN orders o ON o.user_uid=u.uid
       GROUP BY u.uid ORDER BY u.created_at DESC`
    );
    const result = await Promise.all(users.rows.map(async (user) => {
      const addrs = await query('SELECT id,address,label,is_default FROM addresses WHERE user_uid=$1 ORDER BY is_default DESC', [user.uid]);
      return { ...user, addresses: addrs.rows };
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:uid', verifyAdmin, async (req, res) => {
  try {
    const user   = await query('SELECT * FROM users WHERE uid=$1', [req.params.uid]);
    const addrs  = await query('SELECT * FROM addresses WHERE user_uid=$1 ORDER BY is_default DESC', [req.params.uid]);
    const orders = await query('SELECT * FROM orders WHERE user_uid=$1 ORDER BY placed_at DESC', [req.params.uid]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ ...user.rows[0], addresses: addrs.rows, orders: orders.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
