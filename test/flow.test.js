'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-password';

const app = require('../server');
const courses = require('../config/courses.json').modules;

function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const headers = cookie ? { cookie } : {};
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
}

test('candidate journey: signup → resume → videos → shortlisted', async t => {
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const c = client(base);

  let r = await c('POST', '/api/auth/signup', { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', password: 'secret123' });
  assert.equal(r.status, 200);

  r = await c('GET', '/api/modules');
  assert.ok(r.body.modules.every(m => m.locked), 'videos locked before resume');
  assert.ok(!JSON.stringify(r.body).includes('answerIndex'), 'answers never sent to browser');

  const fd = new FormData();
  const resumeText = fs.readFileSync(path.join(__dirname, 'fixtures', 'resume.txt'));
  fd.append('resume', new Blob([resumeText], { type: 'text/plain' }), 'resume.txt');
  r = await c('POST', '/api/resume', fd);
  assert.equal(r.status, 200);
  assert.ok(r.body.candidate.resume.score >= 70, `resume score ${r.body.candidate.resume.score}`);

  r = await c('GET', '/api/modules');
  assert.equal(r.body.modules[0].locked, false);
  assert.equal(r.body.modules[1].locked, true);

  // Cannot skip past the first question or answer ahead of the video.
  const first = courses[0];
  r = await c('POST', `/api/modules/${first.id}/progress`, { position: first.durationSec });
  assert.equal(r.body.maxWatched, first.checkpoints[0].at);
  r = await c('POST', `/api/modules/${first.id}/checkpoints/${first.checkpoints[1].id}`, { choice: 0 });
  assert.equal(r.status, 400);
  r = await c('POST', `/api/modules/${first.id}/complete`);
  assert.equal(r.status, 400);

  let last;
  for (const m of courses) {
    for (const [i, cp] of m.checkpoints.entries()) {
      await c('POST', `/api/modules/${m.id}/progress`, { position: cp.at });
      // Get one question wrong overall to make sure scoring is not all-or-nothing.
      const choice = m.id === 'al' && i === 0 ? (cp.answerIndex + 1) % cp.options.length : cp.answerIndex;
      r = await c('POST', `/api/modules/${m.id}/checkpoints/${cp.id}`, { choice });
      assert.equal(r.status, 200);
      r = await c('POST', `/api/modules/${m.id}/checkpoints/${cp.id}`, { choice });
      assert.equal(r.status, 409, 'one attempt per question');
    }
    await c('POST', `/api/modules/${m.id}/progress`, { position: m.durationSec });
    last = await c('POST', `/api/modules/${m.id}/complete`);
    assert.equal(last.status, 200);
  }
  assert.equal(last.body.allDone, true);
  const result = last.body.candidate.result;
  assert.equal(result.assessment.correct, result.assessment.total - 1);
  assert.equal(result.status, 'shortlisted');

  // Recruiter sees the candidate and can override.
  const a = client(base);
  r = await a('POST', '/api/auth/login', { email: 'admin@test.local', password: 'admin-password' });
  assert.equal(r.body.role, 'admin');
  r = await a('GET', '/api/admin/candidates');
  const row = r.body.candidates.find(x => x.email === 'jane@example.com');
  assert.equal(row.status, 'shortlisted');
  r = await a('POST', `/api/admin/candidates/${row.id}/status`, { status: 'review', note: 'Check references' });
  assert.equal(r.body.candidate.result.status, 'review');
  r = await a('GET', '/api/admin/export.csv');
  assert.match(r.body, /jane@example.com/);

  // Candidates cannot reach admin endpoints.
  r = await c('GET', '/api/admin/candidates');
  assert.equal(r.status, 403);
});

test('weak candidate is not progressed', async t => {
  const server = app.listen(0);
  t.after(() => server.close());
  const c = client(`http://127.0.0.1:${server.address().port}`);
  await c('POST', '/api/auth/signup', { firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', password: 'secret123' });
  const fd = new FormData();
  fd.append('resume', new Blob(['Graphic designer making logos and brand identities in Illustrator for small studios. '.repeat(6)]), 'cv.txt');
  await c('POST', '/api/resume', fd);
  let last;
  for (const m of courses) {
    for (const cp of m.checkpoints) {
      await c('POST', `/api/modules/${m.id}/progress`, { position: cp.at });
      await c('POST', `/api/modules/${m.id}/checkpoints/${cp.id}`, { choice: (cp.answerIndex + 1) % cp.options.length });
    }
    await c('POST', `/api/modules/${m.id}/progress`, { position: m.durationSec });
    last = await c('POST', `/api/modules/${m.id}/complete`);
  }
  assert.equal(last.body.candidate.result.status, 'not_progressed');
});
