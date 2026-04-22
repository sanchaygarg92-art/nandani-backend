// src/routes/orders.js
const express = require('express');
const router  = express.Router();
const { query, getClient } = require('../db/pool');
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const DELIVERY_FEE = 30;
const DELIVERY_CITIES = ['panchkula', 'chandigarh', 'zirakpur'];

// ── POST /orders ──────────────────────────────────────────────
// Place a new order
router.post('/', verifyToken, async (req, res) => {
  const { items, address, delivery_date, payment, payment_id, note } = req.body;

  // Validate
  if (!items?.length)    return res.status(400).json({ error: 'No items in order' });
  if (!address?.trim())  return res.status(400).json({ error: 'Delivery address required' });
  if (!delivery_date)    return res.status(400).json({ error: 'Delivery date required' });

  // Validate delivery city
  const lower = address.toLowerCase();
  const validCity = DELIVERY_CITIES.some(c => lower.includes(c));
  if (!validCity) {
    return res.status(400).json({
      error: 'OUTSIDE_DELIVERY_AREA',
      message: 'We deliver only to Panchkula, Chandigarh, and Zirakpur.',
    });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Get user info
    const userResult = await client.query('SELECT * FROM users WHERE uid = $1', [req.uid]);
    if (!userResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];

    // Calculate totals
    const subtotal = items.reduce((s, i) => s + (i.price || 0), 0);
    const total    = subtotal + DELIVERY_FEE;
    const orderId  = 'NO' + Date.now();

    // Insert order
    const orderResult = await client.query(
      `INSERT INTO orders
        (id, user_uid, user_name, user_phone, user_email, address, delivery_date,
         payment, payment_id, note, subtotal, delivery_fee, total, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
       RETURNING *`,
      [
        orderId, req.uid, user.name, user.phone, user.email,
        address.trim(), delivery_date, payment || 'cod',
        payment_id || '', note || '',
        subtotal, DELIVERY_FEE, total,
      ]
    );

    // Insert order items
    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, name, qty, unit, price) VALUES ($1,$2,$3,$4,$5)',
        [orderId, item.name, item.qty, item.unit, item.price]
      );
    }

    // Auto-save address
    const addrExists = await client.query(
      'SELECT id FROM addresses WHERE user_uid = $1 AND address = $2',
      [req.uid, address.trim()]
    );
    if (!addrExists.rows.length) {
      await client.query(
        'INSERT INTO addresses (user_uid, address, label) VALUES ($1,$2,$3)',
        [req.uid, address.trim(), 'Saved']
      );
    }

    await client.query('COMMIT');

    // Return full order with items
    const order = orderResult.rows[0];
    res.status(201).json({ ...order, items });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Order creation error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── GET /orders/my ────────────────────────────────────────────
// Get current user's orders only
router.get('/my', verifyToken, async (req, res) => {
  try {
    const orders = await query(
      'SELECT * FROM orders WHERE user_uid = $1 ORDER BY placed_at DESC',
      [req.uid]
    );

    // Attach items to each order
    const result = await Promise.all(
      orders.rows.map(async (order) => {
        const items = await query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
        return { ...order, items: items.rows };
      })
    );

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /orders/:id ───────────────────────────────────────────
// Get single order (user can only see their own)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const order = await query(
      'SELECT * FROM orders WHERE id = $1 AND user_uid = $2',
      [req.params.id, req.uid]
    );
    if (!order.rows.length) return res.status(404).json({ error: 'Order not found' });

    const items = await query('SELECT * FROM order_items WHERE order_id = $1', [req.params.id]);
    res.json({ ...order.rows[0], items: items.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN: GET /orders/admin/all ──────────────────────────────
// Get ALL orders across all users
router.get('/admin/all', verifyAdmin, async (req, res) => {
  const { status, limit = 100, offset = 0 } = req.query;
  try {
    let q = 'SELECT * FROM orders';
    const params = [];
    if (status) { q += ' WHERE status = $1'; params.push(status); }
    q += ` ORDER BY placed_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, offset);

    const orders = await query(q, params);

    const result = await Promise.all(
      orders.rows.map(async (order) => {
        const items = await query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
        return { ...order, items: items.rows };
      })
    );

    // Get counts
    const counts = await query(
      `SELECT status, COUNT(*) as count FROM orders GROUP BY status`
    );
    const total = await query('SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM orders WHERE status = $1', ['delivered']);

    res.json({
      orders: result,
      meta: {
        counts:  counts.rows,
        total:   parseInt(total.rows[0].count),
        revenue: parseInt(total.rows[0].revenue),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN: PUT /orders/admin/:id/status ──────────────────────
// Update order status — delivered | cancelled | pending
router.put('/admin/:id/status', verifyAdmin, async (req, res) => {
  const { status, note } = req.body;
  const validStatuses = ['pending', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Get current order
    const current = await client.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    const oldStatus = current.rows[0].status;

    // Update order
    const result = await client.query(
      `UPDATE orders SET
        status = $1,
        updated_at = NOW(),
        delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
        cancelled_at = CASE WHEN $1 = 'cancelled' THEN NOW() ELSE cancelled_at END
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    );

    // Log admin action
    await client.query(
      'INSERT INTO admin_logs (action, order_id, old_status, new_status, note) VALUES ($1,$2,$3,$4,$5)',
      ['UPDATE_STATUS', req.params.id, oldStatus, status, note || '']
    );

    await client.query('COMMIT');

    const items = await query('SELECT * FROM order_items WHERE order_id = $1', [req.params.id]);
    res.json({ ...result.rows[0], items: items.rows });

  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── ADMIN: GET /orders/admin/logs ─────────────────────────────
router.get('/admin/logs', verifyAdmin, async (req, res) => {
  try {
    const logs = await query('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 100');
    res.json(logs.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
