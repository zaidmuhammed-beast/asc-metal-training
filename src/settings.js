'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DEFAULTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'screening.json'), 'utf8'));
const COURSES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'courses.json'), 'utf8')).modules;

// Admin edits are stored in the db and layered over the config file defaults.
const get = () => ({ ...structuredClone(DEFAULTS), ...(db.state.settings || {}) });

function update(patch) {
  const next = { ...get(), ...patch };
  const n = v => Number.isFinite(Number(v)) ? Number(v) : NaN;
  const nums = [next.weights.resume, next.weights.assessment, ...Object.values(next.thresholds)].map(n);
  if (nums.some(v => Number.isNaN(v) || v < 0 || v > 100)) throw new Error('Weights and thresholds must be numbers between 0 and 100.');
  if (!Array.isArray(next.resumeProfile?.skills)) throw new Error('resumeProfile.skills must be a list.');
  db.state.settings = next;
  db.save();
  return next;
}

const courses = () => COURSES;
const totalCheckpoints = () => COURSES.reduce((s, m) => s + m.checkpoints.length, 0);

module.exports = { get, update, courses, totalCheckpoints };
