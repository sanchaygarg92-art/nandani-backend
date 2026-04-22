// src/db/pool.js
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => console.error('DB pool error:', err.message));
  return pool;
}

async function query(text, params) {
  const p = getPool();
  const res = await p.query(text, params);
  return res;
}

async function getClient() {
  const p = getPool();
  return p.connect();
}

module.exports = { query, getClient };
