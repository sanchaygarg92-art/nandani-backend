// scripts/migrate-addresses.js
// Run: DATABASE_URL="..." node scripts/migrate-addresses.js
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Adding structured address columns...');
    await client.query(`
      ALTER TABLE addresses
        ADD COLUMN IF NOT EXISTS house_no TEXT,
        ADD COLUMN IF NOT EXISTS area TEXT,
        ADD COLUMN IF NOT EXISTS city TEXT,
        ADD COLUMN IF NOT EXISTS pincode TEXT;
    `);
    console.log('✅ Address columns added successfully');
  } catch (e) {
    console.error('Migration error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
