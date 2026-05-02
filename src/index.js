// src/index.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health Check — always responds immediately ────────────────
app.get('/', (req, res) => {
  res.json({ app: 'Nandani Organic API', status: 'running', time: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// ── Mount routes immediately (Express handles DB errors per-request) ──
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/users',  require('./routes/users'));
app.use('/api/orders', require('./routes/orders'));
console.log('✅ Routes mounted');

// ── Warm up DB connection in background ──────────────────────
(async () => {
  try {
    const { query } = require('./db/pool');
    await query('SELECT 1');
    console.log('✅ DB connected');
  } catch (e) {
    console.error('⚠️  DB warmup failed (will retry on first request):', e.message);
  }
})();

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🐄 Nandani Organic API on port ${PORT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`   DB: ${process.env.DATABASE_URL ? '✅ configured' : '❌ missing'}`);
});

module.exports = app;
