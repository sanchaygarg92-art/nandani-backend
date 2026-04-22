// scripts/setup-db.js
// Run once: node scripts/setup-db.js
require('dotenv').config();
const { pool } = require('../src/db');

async function setupDatabase() {
  console.log('🔧 Setting up Nandani Organic database...\n');

  try {
    // ── USERS TABLE ───────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        uid           VARCHAR(128) PRIMARY KEY,
        name          VARCHAR(255) NOT NULL,
        phone         VARCHAR(20)  UNIQUE,
        email         VARCHAR(255) UNIQUE,
        firebase_uid  VARCHAR(128) UNIQUE,
        role          VARCHAR(20)  NOT NULL DEFAULT 'customer',
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ users table created');

    // ── ADDRESSES TABLE ───────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS addresses (
        id          SERIAL       PRIMARY KEY,
        user_uid    VARCHAR(128) NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
        label       VARCHAR(100) DEFAULT 'Home',
        full_address TEXT        NOT NULL,
        city        VARCHAR(100),
        is_default  BOOLEAN      DEFAULT false,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT valid_city CHECK (
          city IS NULL OR
          LOWER(city) IN ('panchkula', 'chandigarh', 'zirakpur')
        )
      );
    `);
    console.log('✅ addresses table created');

    // ── ORDERS TABLE ──────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id              VARCHAR(32)  PRIMARY KEY,
        user_uid        VARCHAR(128) NOT NULL REFERENCES users(uid),
        address_text    TEXT         NOT NULL,
        city            VARCHAR(100),
        delivery_date   VARCHAR(50)  NOT NULL,
        payment_method  VARCHAR(20)  NOT NULL CHECK (payment_method IN ('upi','card','cod')),
        payment_id      VARCHAR(128),
        payment_status  VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed')),
        status          VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','out_for_delivery','delivered','cancelled')),
        subtotal        INTEGER      NOT NULL,
        delivery_fee    INTEGER      NOT NULL DEFAULT 30,
        total           INTEGER      NOT NULL,
        note            TEXT,
        placed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        delivered_at    TIMESTAMPTZ,
        cancelled_at    TIMESTAMPTZ,
        cancelled_by    VARCHAR(50)
      );
    `);
    console.log('✅ orders table created');

    // ── ORDER ITEMS TABLE ─────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id          SERIAL       PRIMARY KEY,
        order_id    VARCHAR(32)  NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        name        VARCHAR(100) NOT NULL,
        quantity    INTEGER      NOT NULL,
        unit        VARCHAR(10)  NOT NULL,
        unit_price  INTEGER      NOT NULL,
        total_price INTEGER      NOT NULL
      );
    `);
    console.log('✅ order_items table created');

    // ── INDEXES ───────────────────────────────────────────────
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_uid);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_placed  ON orders(placed_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_addr_user      ON addresses(user_uid);`);
    console.log('✅ indexes created');

    // ── UPDATED_AT TRIGGER ────────────────────────────────────
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ language 'plpgsql';
    `);
    await pool.query(`
      DROP TRIGGER IF EXISTS update_users_updated_at  ON users;
      CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    await pool.query(`
      DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
      CREATE TRIGGER update_orders_updated_at
        BEFORE UPDATE ON orders
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    console.log('✅ triggers created');

    console.log('\n🎉 Database setup complete!\n');
    console.log('Tables created:');
    console.log('  📋 users         — all registered users');
    console.log('  📍 addresses     — saved delivery addresses');
    console.log('  📦 orders        — all orders');
    console.log('  🛒 order_items   — items per order');

  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
