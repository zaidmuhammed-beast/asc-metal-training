'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreResume, detectExperienceYears } = require('../src/resume');
const profile = require('../config/screening.json').resumeProfile;

const STRONG = `Jane Smith — jane.smith@example.com — +44 7700 900123
Warehouse & Sales Assistant with 4 years experience in a metals stockholder.
EXPERIENCE
Sales Assistant, Northern Steel Ltd, Mar 2021 – Present
Customer service on the trade counter, quoting stainless and aluminium bar, order processing in Sage, stock control.
Warehouse Operative, FastParts, 2018 - 2021
Picking, packing and dispatch, forklift (counterbalance), manual handling and health and safety duties.
EDUCATION  BTEC Diploma in Engineering
CERTIFICATES  RTITB forklift licence, First Aid at Work, full UK driving licence
Skills: Excel, teamwork, communication, reading technical drawings and using a vernier caliper.
${'Reliable and punctual team member. '.repeat(20)}`;

test('detects merged experience from date ranges', () => {
  const now = new Date('2026-01-01');
  assert.equal(detectExperienceYears('Jan 2020 - Dec 2021 and 2021 – 2023', now), 4);
  assert.ok(detectExperienceYears('Mar 2021 – Present', now) >= 4.5);
  assert.equal(detectExperienceYears('I have 6+ years of warehouse experience', now), 6);
});

test('strong, relevant resume scores high with evidence', () => {
  const r = scoreResume(STRONG, profile);
  assert.equal(r.needsReview, false);
  assert.ok(r.score >= 80, `expected >= 80, got ${r.score}`);
  assert.ok(r.breakdown.skills.matched.some(s => s.name === 'Forklift'));
  assert.equal(r.breakdown.education.level, 'Diploma / HND / A-levels');
  assert.ok(r.breakdown.certifications.matched.length >= 2);
});

test('unrelated resume scores low', () => {
  const r = scoreResume('Graphic designer. I make logos in Illustrator and Photoshop for small brands. '.repeat(5), profile);
  assert.ok(r.score < 30, `expected < 30, got ${r.score}`);
});

test('unreadable resume is flagged for manual review', () => {
  const r = scoreResume('   ', profile);
  assert.equal(r.needsReview, true);
  assert.equal(r.score, 0);
});
