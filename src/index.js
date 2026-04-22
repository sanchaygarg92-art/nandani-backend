// src/index.js
require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');

const authRoutes  = require('./routes/auth');
const userRoutes  = require('./routes/users');
const orderRoutes = require('./routes/orders');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security & Middleware ──────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ─────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ── Health Check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    app:     'Nandani Organic Backend API',
    version: '1.0.0',
    status:  'running',
    time:    new Date().toISOString(),
  });
});

app.get('/health', async (req, res) => {
  try {
    const { query } = require('./db/pool');
    await query('SELECT 1');
    res.json({ status: 'healthy', db: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'unhealthy', db: 'disconnected', error: e.message });
  }
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/users',  userRoutes);
app.use('/api/orders', orderRoutes);

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐄 Nandani Organic API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Env:    ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
