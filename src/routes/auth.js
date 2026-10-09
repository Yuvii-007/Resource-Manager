import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { storage } from '../db/storage.js';

const router = express.Router();
const JWT_SECRET = process.env.SESSION_SECRET || 'rm_sec_vault_k892x0_dev';

// In-memory token store for revoked tokens / active sessions
const sessions = new Map();

export function generateToken(user) {
  const payload = {
    userId: user.id,
    email: user.email,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30 // 30 days
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  const token = `${data}.${signature}`;
  sessions.set(token, payload);
  return token;
}

export function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) {
      sessions.delete(token);
      return null;
    }
    return payload;
  } catch (e) {
    return null;
  }
}

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
      req.userId = payload.userId;
      return next();
    }
  }
  // Default to single-user local mode if not logged in
  req.userId = 'default_user';
  req.user = null;
  next();
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
  req.user = payload;
  req.userId = payload.userId;
  next();
}

// Routes
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Valid email and password are required' });
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await storage.getUserByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const user = await storage.createUser({ email: cleanEmail, passwordHash });
    const token = generateToken(user);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: user.id, email: user.email }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = await storage.getUserByEmail(cleanEmail);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user);
    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

router.get('/me', optionalAuth, async (req, res) => {
  if (req.user) {
    const user = await storage.getUserById(req.userId);
    return res.json({
      authenticated: true,
      user: { id: user.id, email: user.email }
    });
  }
  res.json({
    authenticated: false,
    user: { id: 'default_user', email: 'local@device' }
  });
});

router.post('/logout', (req, res) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    sessions.delete(header.slice(7));
  }
  res.json({ message: 'Logged out successfully' });
});

export default router;
