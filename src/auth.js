'use strict';
const crypto = require('crypto');
const db = require('./db');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = 'asc_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(password), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.state.sessions[token] = { userId: user.id, expires: Date.now() + SESSION_TTL_MS };
  db.save();
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS,
    secure: process.env.NODE_ENV === 'production'
  });
}

function readToken(req) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : null;
}

function destroySession(req, res) {
  const token = readToken(req);
  if (token && db.state.sessions[token]) { delete db.state.sessions[token]; db.save(); }
  res.clearCookie(COOKIE);
}

function currentUser(req) {
  const token = readToken(req);
  const s = token && db.state.sessions[token];
  if (!s) return null;
  if (s.expires < Date.now()) { delete db.state.sessions[token]; db.save(); return null; }
  return db.findUser(s.userId);
}

const requireRole = role => (req, res, next) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  if (role && user.role !== role) return res.status(403).json({ error: 'Not allowed.' });
  req.user = user;
  next();
};

module.exports = { hashPassword, verifyPassword, createSession, destroySession, currentUser, requireRole };
