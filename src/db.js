'use strict';
// Minimal JSON-file store. Good for a pilot with a few hundred candidates;
// swap for Postgres/SQLite behind the same functions when scaling up.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const RESUME_DIR = path.join(DATA_DIR, 'resumes');

fs.mkdirSync(RESUME_DIR, { recursive: true });

const EMPTY = { users: [], sessions: {}, settings: null };
let state = load();

function load() {
  if (!fs.existsSync(DB_FILE)) return structuredClone(EMPTY);
  return { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
}

function save() {
  const tmp = DB_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const id = () => crypto.randomUUID();

function findUserByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return state.users.find(u => u.email === e) || null;
}
const findUser = userId => state.users.find(u => u.id === userId) || null;
const candidates = () => state.users.filter(u => u.role === 'candidate');

function insertUser(user) {
  const u = { id: id(), createdAt: new Date().toISOString(), ...user, email: user.email.trim().toLowerCase() };
  state.users.push(u);
  save();
  return u;
}

module.exports = {
  DATA_DIR, RESUME_DIR,
  get state() { return state; },
  save, id, findUserByEmail, findUser, candidates, insertUser,
  _reset() { state = structuredClone(EMPTY); save(); }
};
