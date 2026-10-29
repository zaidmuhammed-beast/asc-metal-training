'use strict';
const db = require('./db');

const DEFAULTS = require('../config/screening.json');
const COURSES = require('../config/courses.json').modules;

// Admin edits are stored in the db and layered over the config file defaults.
// refresh() is called at the start of every API request; get() reads the cache.
let saved = null;
const refresh = async () => { saved = await db.getSettings(); };
const get = () => ({ ...structuredClone(DEFAULTS), ...(saved || {}) });

async function update(patch) {
  const next = { ...get(), ...patch };
  const n = v => Number.isFinite(Number(v)) ? Number(v) : NaN;
  const nums = [next.weights.resume, next.weights.assessment, ...Object.values(next.thresholds)].map(n);
  if (nums.some(v => Number.isNaN(v) || v < 0 || v > 100)) throw new Error('Weights and thresholds must be numbers between 0 and 100.');
  if (!Array.isArray(next.resumeProfile?.skills)) throw new Error('resumeProfile.skills must be a list.');
  await db.setSettings(next);
  saved = next;
  return next;
}

const courses = () => COURSES;
const totalCheckpoints = () => COURSES.reduce((s, m) => s + m.checkpoints.length, 0);

module.exports = { get, refresh, update, courses, totalCheckpoints };
