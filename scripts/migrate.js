// scripts/migrate.js
// Run once to create all database tables
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const migrations = `
-- ─── USERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  uid           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  auth_provider TEXT NOT NULL DEFAULT 'phone',  -- phone | google
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ─── ADDRESSES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS addresses (
  id         SERIAL PRIMARY KEY,
  user_uid   TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  address    TEXT NOT NULL,
  label      TEXT DEFAULT 'Home',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_uid);

-- ─── ORDERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  user_uid      TEXT NOT NULL REFERENCES users(uid),
  user_name     TEXT NOT NULL,
  user_phone    TEXT,
  user_email    TEXT,
  address       TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  payment       TEXT NOT NULL,  -- upi | card | cod
  payment_id    TEXT,
  note          TEXT,
  subtotal      INTEGER NOT NULL,
  delivery_fee  INTEGER NOT NULL DEFAULT 30,
  total         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | delivered | cancelled
  placed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at  TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_uid);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_placed  ON orders(placed_at DESC);

-- ─── ORDER ITEMS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id        SERIAL PRIMARY KEY,
  order_id  TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  qty       INTEGER NOT NULL,
  unit      TEXT NOT NULL,
  price     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ─── ADMIN ACTIONS LOG ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_logs (
  id         SERIAL PRIMARY KEY,
  action     TEXT NOT NULL,
  order_id   TEXT,
  old_status TEXT,
  new_status TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migrations...');
    await client.query(migrations);
    console.log('✅ All tables created successfully!');
    console.log('\nTables created:');
    const result = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    result.rows.forEach(r => console.log('  ·', r.tablename));
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(process.exit);
