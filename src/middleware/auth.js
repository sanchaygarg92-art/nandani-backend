// src/middleware/auth.js
const admin = require('../firebase');

// ── Verify Firebase ID Token ──────────────────────────────────
async function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.phone = decoded.phone_number || null;
    req.email = decoded.email || null;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Verify Admin Secret ───────────────────────────────────────
function verifyAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin access denied' });
  }
  next();
}

// ── Optional token (for public + authed routes) ───────────────
async function optionalToken(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const decoded = await admin.auth().verifyIdToken(header.split('Bearer ')[1]);
      req.uid = decoded.uid;
    } catch (e) {}
  }
  next();
}

module.exports = { verifyToken, verifyAdmin, optionalToken };
