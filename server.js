'use strict';
const path = require('path');
const express = require('express');
const multer = require('multer');

const db = require('./src/db');
const auth = require('./src/auth');
const settings = require('./src/settings');
const resume = require('./src/resume');
const evaluation = require('./src/evaluation');
const notify = require('./src/notify');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // serverless request bodies are capped at ~6 MB after encoding
  fileFilter: (req, file, cb) => {
    const ok = Object.keys(resume.ALLOWED).includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Please upload a PDF, DOCX or TXT file.'), ok);
  }
});

const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
const clean = (s, max = 120) => String(s ?? '').trim().slice(0, max);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Create the first admin account once per process, and load the latest
// scoring rules before every API request.
let ready;
app.use('/api', wrap(async (req, res, next) => {
  await (ready ||= ensureAdmin().catch(e => { ready = null; throw e; }));
  await settings.refresh();
  next();
}));

// ---------------------------------------------------------------- views
function candidateSummary(c) {
  const status = evaluation.effectiveStatus(c);
  return {
    id: c.id,
    firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone,
    location: c.location, position: c.position, createdAt: c.createdAt,
    stage: evaluation.stage(c),
    resume: c.resume ? {
      fileName: c.resume.fileName, uploadedAt: c.resume.uploadedAt, uploads: c.resume.uploads,
      score: c.resume.score, needsReview: c.resume.needsReview, note: c.resume.note, breakdown: c.resume.breakdown
    } : null,
    assessment: evaluation.assessmentScore(c),
    result: c.result ? { ...c.result, status, statusLabel: evaluation.STATUS_LABELS[status] } : null
  };
}

function moduleState(c, m) {
  const p = c.progress?.[m.id] || { maxWatched: 0, answers: {}, completed: false };
  return { maxWatched: p.maxWatched || 0, completed: !!p.completed, answers: p.answers || {} };
}

function publicModules(c) {
  const showFeedback = settings.get().showAnswerFeedback;
  let prevDone = !!c.resume;
  return settings.courses().map(m => {
    const st = moduleState(c, m);
    const locked = !prevDone;
    prevDone = st.completed;
    return {
      id: m.id, title: m.title, tags: m.tags, videoUrl: m.videoUrl, durationSec: m.durationSec,
      chapters: m.chapters,
      checkpoints: m.checkpoints.map(cp => {
        const a = st.answers[cp.id];
        return {
          id: cp.id, at: cp.at, question: cp.question, options: cp.options,
          answered: a ? { choice: a.choice, ...(showFeedback ? { correct: a.correct, explanation: cp.explanation } : {}) } : null
        };
      }),
      locked, maxWatched: st.maxWatched, completed: st.completed
    };
  });
}

function getModuleForCandidate(c, moduleId) {
  const mods = publicModules(c);
  const pm = mods.find(m => m.id === moduleId);
  if (!pm) return { error: [404, 'Module not found.'] };
  if (pm.locked) return { error: [403, 'Finish the previous step first.'] };
  if (c.result) return { error: [409, 'Your assessment has already been submitted.'] };
  const m = settings.courses().find(x => x.id === moduleId);
  c.progress = c.progress || {};
  c.progress[m.id] = c.progress[m.id] || { maxWatched: 0, answers: {}, completed: false };
  return { m, p: c.progress[m.id] };
}

// ---------------------------------------------------------------- auth
app.post('/api/auth/signup', wrap(async (req, res) => {
  const b = req.body || {};
  const user = {
    role: 'candidate',
    firstName: clean(b.firstName, 60), lastName: clean(b.lastName, 60),
    email: clean(b.email, 160), phone: clean(b.phone, 40),
    location: clean(b.location, 80), position: clean(b.position, 120) || settings.get().role
  };
  if (!user.firstName || !user.lastName) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!isEmail(user.email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (String(b.password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (await db.findUserByEmail(user.email)) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
  const created = await db.insertUser({ ...user, passwordHash: auth.hashPassword(b.password), progress: {} });
  await auth.createSession(req, res, created);
  await notify.send(created.email, 'Your application has started', `Hi ${created.firstName}, thanks for registering. Next step: upload your resume.`);
  res.json({ ok: true, role: created.role });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await db.findUserByEmail(email);
  if (!user || !auth.verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Incorrect email or password.' });
  await auth.createSession(req, res, user);
  res.json({ ok: true, role: user.role });
}));

app.post('/api/auth/logout', wrap(async (req, res) => { await auth.destroySession(req, res); res.json({ ok: true }); }));

// ---------------------------------------------------------------- candidate
const candidate = auth.requireRole('candidate');

app.get('/api/me', candidate, (req, res) => {
  res.json({ candidate: candidateSummary(req.user), role: settings.get().role });
});

app.post('/api/resume', candidate, upload.single('resume'), wrap(async (req, res) => {
  const c = req.user;
  if (!req.file) return res.status(400).json({ error: 'Please choose a file to upload.' });
  if (c.result) return res.status(409).json({ error: 'Your application has already been assessed.' });
  let text;
  try { text = await resume.extractText(req.file.buffer, req.file.originalname); }
  catch (e) { return res.status(400).json({ error: e.message || 'We could not read that file.' }); }

  const scored = resume.scoreResume(text, settings.get().resumeProfile);
  const ext = path.extname(req.file.originalname).toLowerCase();
  const storedName = `${c.id}${ext}`;
  if (c.resume?.storedName && c.resume.storedName !== storedName) await db.deleteResume(c.resume.storedName);
  await db.setResume(storedName, req.file.buffer);

  c.resume = {
    fileName: clean(req.file.originalname, 200), storedName, uploadedAt: new Date().toISOString(),
    uploads: (c.resume?.uploads || 0) + 1, text: text.slice(0, 50000), ...scored
  };
  await db.saveUser(c);
  res.json({ candidate: candidateSummary(c) });
}));

app.get('/api/modules', candidate, (req, res) => res.json({ modules: publicModules(req.user) }));

// Watch progress. The server never lets the watched position pass the first
// unanswered checkpoint, so questions cannot be skipped by seeking.
app.post('/api/modules/:id/progress', candidate, wrap(async (req, res) => {
  const r = getModuleForCandidate(req.user, req.params.id);
  if (r.error) return res.status(r.error[0]).json({ error: r.error[1] });
  const { m, p } = r;
  const next = m.checkpoints.find(cp => !p.answers[cp.id]);
  const cap = next ? next.at : m.durationSec;
  const pos = Math.min(Math.max(Number(req.body?.position) || 0, 0), cap);
  if (pos > p.maxWatched) { p.maxWatched = pos; await db.saveUser(req.user); }
  res.json({ maxWatched: p.maxWatched });
}));

app.post('/api/modules/:id/checkpoints/:cp', candidate, wrap(async (req, res) => {
  const r = getModuleForCandidate(req.user, req.params.id);
  if (r.error) return res.status(r.error[0]).json({ error: r.error[1] });
  const { m, p } = r;
  const cp = m.checkpoints.find(x => x.id === req.params.cp);
  if (!cp) return res.status(404).json({ error: 'Question not found.' });
  if (p.answers[cp.id]) return res.status(409).json({ error: 'This question has already been answered.' });
  if (p.maxWatched + 1 < cp.at) return res.status(400).json({ error: 'Watch the video up to this question first.' });
  const choice = Number(req.body?.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= cp.options.length) return res.status(400).json({ error: 'Please pick an answer.' });
  const correct = choice === cp.answerIndex;
  p.answers[cp.id] = { choice, correct, at: new Date().toISOString() };
  p.maxWatched = Math.max(p.maxWatched, cp.at);
  await db.saveUser(req.user);
  const fb = settings.get().showAnswerFeedback;
  res.json(fb ? { correct, explanation: cp.explanation, correctIndex: cp.answerIndex } : { recorded: true });
}));

app.post('/api/modules/:id/complete', candidate, wrap(async (req, res) => {
  const c = req.user;
  const r = getModuleForCandidate(c, req.params.id);
  if (r.error) return res.status(r.error[0]).json({ error: r.error[1] });
  const { m, p } = r;
  if (m.checkpoints.some(cp => !p.answers[cp.id])) return res.status(400).json({ error: 'Answer every question in this video first.' });
  if (p.maxWatched < m.durationSec - 2) return res.status(400).json({ error: 'Watch the video to the end first.' });
  p.completed = true;

  const allDone = settings.courses().every(x => c.progress?.[x.id]?.completed);
  if (allDone) {
    c.result = evaluation.evaluate(c);
    const status = evaluation.effectiveStatus(c);
    await notify.send(c.email, 'Your assessment results',
      `Hi ${c.firstName}, your results are ready. Overall score: ${c.result.finalScore}/100. Outcome: ${evaluation.STATUS_LABELS[status]}.`);
  }
  await db.saveUser(c);
  res.json({ completed: true, allDone, candidate: candidateSummary(c) });
}));

// ---------------------------------------------------------------- admin
const admin = auth.requireRole('admin');

app.get('/api/admin/candidates', admin, wrap(async (req, res) => {
  const all = await db.candidates();
  const list = all.map(u => ({ ...candidateSummary(u), overridden: !!u.override })).map(({ resume: r, assessment, ...c }) => ({
    ...c,
    resumeScore: r?.score ?? null, needsReview: !!r?.needsReview,
    assessmentScore: c.result ? c.result.assessmentScore : (assessment.answered ? assessment.score : null),
    answered: assessment.answered, totalQuestions: assessment.total,
    finalScore: c.result?.finalScore ?? null, status: c.result?.status ?? null
  }));
  res.json({ candidates: list, statusLabels: evaluation.STATUS_LABELS });
}));

app.get('/api/admin/candidates/:id', admin, wrap(async (req, res) => {
  const c = await db.findUser(req.params.id);
  if (!c || c.role !== 'candidate') return res.status(404).json({ error: 'Candidate not found.' });
  const answers = settings.courses().map(m => ({
    id: m.id, title: m.title,
    questions: m.checkpoints.map(cp => {
      const a = c.progress?.[m.id]?.answers?.[cp.id];
      return { question: cp.question, correctAnswer: cp.options[cp.answerIndex], given: a ? cp.options[a.choice] : null, correct: a?.correct ?? null };
    })
  }));
  res.json({ candidate: candidateSummary(c), override: c.override || null, answers });
}));

app.get('/api/admin/candidates/:id/resume', admin, wrap(async (req, res) => {
  const c = await db.findUser(req.params.id);
  const file = c?.resume && await db.getResume(c.resume.storedName);
  if (!file) return res.status(404).json({ error: 'No resume uploaded.' });
  const ext = path.extname(c.resume.storedName);
  res.type(resume.ALLOWED[ext] || 'application/octet-stream').attachment(c.resume.fileName).send(file);
}));

app.post('/api/admin/candidates/:id/status', admin, wrap(async (req, res) => {
  const c = await db.findUser(req.params.id);
  if (!c || c.role !== 'candidate') return res.status(404).json({ error: 'Candidate not found.' });
  const status = req.body?.status;
  if (status === null || status === '') delete c.override;
  else if (evaluation.STATUS_LABELS[status]) c.override = { status, note: clean(req.body?.note, 500), by: req.user.email, at: new Date().toISOString() };
  else return res.status(400).json({ error: 'Unknown status.' });
  await db.saveUser(c);
  if (c.override && req.body?.notify) {
    await notify.send(c.email, 'Update on your application', `Hi ${c.firstName}, your application status is now: ${evaluation.STATUS_LABELS[status]}.`);
  }
  res.json({ candidate: candidateSummary(c), override: c.override || null });
}));

app.get('/api/admin/settings', admin, (req, res) => res.json({ settings: settings.get() }));

app.put('/api/admin/settings', admin, wrap(async (req, res) => {
  try { res.json({ settings: await settings.update(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));

// Re-run scoring for everyone with the current settings (overrides are kept).
app.post('/api/admin/reevaluate', admin, wrap(async (req, res) => {
  const profile = settings.get().resumeProfile;
  const all = await db.candidates();
  await Promise.all(all.map(c => {
    if (c.resume?.text) Object.assign(c.resume, resume.scoreResume(c.resume.text, profile));
    if (c.result) c.result = evaluation.evaluate(c);
    return db.saveUser(c);
  }));
  res.json({ ok: true, updated: all.length });
}));

app.get('/api/admin/export.csv', admin, wrap(async (req, res) => {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['First name', 'Last name', 'Email', 'Phone', 'Location', 'Position', 'Registered', 'Stage', 'Resume score', 'Assessment score', 'Final score', 'Status']];
  for (const c of (await db.candidates()).map(candidateSummary)) {
    rows.push([c.firstName, c.lastName, c.email, c.phone, c.location, c.position, c.createdAt, c.stage,
      c.resume?.score, c.result?.assessmentScore, c.result?.finalScore, c.result?.statusLabel]);
  }
  res.type('text/csv').attachment('candidates.csv').send(rows.map(r => r.map(esc).join(',')).join('\n'));
}));

// ---------------------------------------------------------------- errors
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.startsWith('Please upload')) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 4 MB).' : err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ---------------------------------------------------------------- boot
async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'change-me-now';
  // Never create a guessable admin on a deployed site.
  if (process.env.STORAGE === 'blobs' && !process.env.ADMIN_PASSWORD) {
    console.warn('[setup] ADMIN_PASSWORD is not set, so no admin account was created.');
    return;
  }
  if (await db.findUserByEmail(email) || await db.hasAdmin()) return;
  await db.insertUser({ role: 'admin', email, firstName: 'Admin', lastName: '', passwordHash: auth.hashPassword(password) });
  if (!process.env.ADMIN_PASSWORD && process.env.NODE_ENV !== 'test') {
    console.warn(`[setup] Created admin ${email} with the default password "${password}". Set ADMIN_EMAIL / ADMIN_PASSWORD before going live.`);
  }
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Candidate portal running → http://localhost:${port}  (admin: /admin.html)`));
}

module.exports = app;
