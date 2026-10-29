'use strict';
// Data access. Each user is its own record so concurrent candidates never
// overwrite each other's progress.
//   users/<id>            user record (candidates and admins)
//   emails/<sha256>       email → user id index
//   sessions/<token>      login sessions
//   resumes/<id><ext>     uploaded resume files
//   settings              admin-edited scoring rules
const crypto = require('crypto');
const store = require('./store');

const emailKey = email => 'emails/' + crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
const id = () => crypto.randomUUID();

const findUser = userId => (/^[\w-]+$/.test(userId || '') ? store.get(`users/${userId}`) : null);

async function findUserByEmail(email) {
  const ref = await store.get(emailKey(email));
  return ref ? findUser(ref.id) : null;
}

async function insertUser(user) {
  const u = { id: id(), createdAt: new Date().toISOString(), ...user, email: user.email.trim().toLowerCase() };
  await store.set(`users/${u.id}`, u);
  await store.set(emailKey(u.email), { id: u.id });
  return u;
}

const saveUser = u => store.set(`users/${u.id}`, u);

async function allUsers() {
  const keys = await store.list('users');
  return (await Promise.all(keys.map(k => store.get(k)))).filter(Boolean);
}
const candidates = async () => (await allUsers()).filter(u => u.role === 'candidate');
const hasAdmin = async () => (await allUsers()).some(u => u.role === 'admin');

module.exports = {
  findUser, findUserByEmail, insertUser, saveUser, candidates, hasAdmin,
  getSession: token => (/^[a-f0-9]{64}$/.test(token || '') ? store.get(`sessions/${token}`) : null),
  setSession: (token, s) => store.set(`sessions/${token}`, s),
  deleteSession: token => store.delete(`sessions/${token}`),
  getSettings: () => store.get('settings'),
  setSettings: s => store.set('settings', s),
  getResume: name => store.get(`resumes/${name}`, 'buffer'),
  setResume: (name, buf) => store.set(`resumes/${name}`, buf),
  deleteResume: name => store.delete(`resumes/${name}`)
};
