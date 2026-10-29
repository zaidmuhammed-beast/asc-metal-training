'use strict';
// Candidate portal — vanilla JS single page app.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.status = res.status; throw e; }
  return data;
}

const COLORS = { al: 'var(--al)', ss: 'var(--ss)', cu: 'var(--cu)', br: 'var(--br)', pb: 'var(--pb)' };
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
const ICON_LOCK = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const PLAY = '<svg viewBox="0 0 20 20" fill="currentColor"><polygon points="5,3 18,10 5,17"/></svg>';
const PAUSE = '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="3" width="4" height="14"/><rect x="12" y="3" width="4" height="14"/></svg>';

const S = { me: null, role: '', modules: [], view: 'overview', player: null };

// ------------------------------------------------------------------ auth
function showAuth(mode = 'signin') {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  $('#signin-form').classList.toggle('hidden', mode !== 'signin');
  $('#signup-form').classList.toggle('hidden', mode !== 'signup');
}
$$('[data-goto]').forEach(a => a.addEventListener('click', () => showAuth(a.dataset.goto)));

function formError(form, msg) {
  const box = $('[data-err]', form);
  box.textContent = msg || '';
  box.classList.toggle('hidden', !msg);
}

$('#signin-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('/api/auth/login', { body: { email: f.email.value, password: f.password.value } });
    if (r.role === 'admin') { location.href = '/admin.html'; return; }
    await boot();
  } catch (err) { formError(f, err.message); }
});

$('#signup-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (f.password.value !== f.password2.value) return formError(f, 'Passwords do not match.');
  const body = Object.fromEntries(['firstName', 'lastName', 'email', 'phone', 'location', 'password'].map(k => [k, f[k].value]));
  try { await api('/api/auth/signup', { body }); await boot('resume'); }
  catch (err) { formError(f, err.message); }
});

$('#logout').addEventListener('click', async () => {
  stopPlayer();
  await api('/api/auth/logout', { method: 'POST' });
  showAuth('signin');
});

// ------------------------------------------------------------------ shell
async function refresh() {
  const [me, mods] = await Promise.all([api('/api/me'), api('/api/modules')]);
  S.me = me.candidate; S.role = me.role; S.modules = mods.modules;
  const c = S.me;
  $('#tb-avatar').textContent = (c.firstName[0] + (c.lastName[0] || '')).toUpperCase();
  $('#tb-name').textContent = `${c.firstName} ${c.lastName}`;
  $('#tb-role').textContent = c.position;
  $('#pill-resume').textContent = c.resume ? c.resume.score : '';
  const done = S.modules.filter(m => m.completed).length;
  $('#pill-assess').textContent = `${done}/${S.modules.length}`;
}

async function boot(view) {
  try { await refresh(); }
  catch (e) { if (e.status === 401 || e.status === 403) return showAuth('signin'); throw e; }
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  go(view || nextStepView());
}

function nextStepView() {
  const c = S.me;
  if (c.result) return 'results';
  if (!c.resume) return 'resume';
  return 'assessment';
}

$$('.nav-item[data-view]').forEach(n => n.addEventListener('click', () => go(n.dataset.view)));

const TITLES = { overview: 'My application', resume: 'Resume', assessment: 'Video assessment', module: 'Video assessment', results: 'Results' };

function go(view, arg) {
  stopPlayer();
  S.view = view;
  $('#tb-title').textContent = TITLES[view];
  $$('.nav-item[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === (view === 'module' ? 'assessment' : view)));
  ({ overview: renderOverview, resume: renderResume, assessment: renderAssessment, module: renderModule, results: renderResults })[view](arg);
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ overview
function renderOverview() {
  const c = S.me;
  const done = S.modules.filter(m => m.completed).length;
  const steps = [
    { t: 'Account created', p: 'You are registered.', done: true },
    { t: 'Resume uploaded', p: c.resume ? `Resume score: ${c.resume.score}/100` : 'Upload your resume to be scored.', done: !!c.resume },
    { t: 'Video assessment', p: `${done} of ${S.modules.length} videos completed`, done: done === S.modules.length },
    { t: 'Results', p: c.result ? c.result.statusLabel : 'Available when the assessment is finished.', done: !!c.result }
  ];
  const cur = steps.findIndex(s => !s.done);
  const cta = !c.resume ? ['resume', 'Upload your resume'] : !c.result ? ['assessment', done ? 'Continue the assessment' : 'Start the video assessment'] : ['results', 'View your results'];
  $('#view').innerHTML = `
    <p class="lead">Hi ${esc(c.firstName)} — here's where your application for <b>${esc(c.position)}</b> stands.</p>
    <div class="stepper">${steps.map((s, i) => `
      <div class="step ${s.done ? 'done' : ''} ${i === cur ? 'current' : ''}">
        <div class="n">${s.done ? '✓' : i + 1}</div><h4>${s.t}</h4><p>${esc(s.p)}</p>
      </div>`).join('')}</div>
    <div class="card">
      <h3>${c.result ? 'Your assessment is complete' : 'Next step'}</h3>
      <p class="muted" style="margin-bottom:14px">${c.result
        ? 'Thanks for completing every step. Your results and outcome are ready.'
        : 'Each video pauses automatically when a question comes up. Answer it to keep watching — you get one attempt per question, so take your time.'}</p>
      <button class="btn" id="cta">${cta[1]} →</button>
    </div>`;
  $('#cta').onclick = () => go(cta[0]);
}

// ------------------------------------------------------------------ resume
function scoreBars(r, withSkills = true) {
  if (!r.breakdown) return '';
  const b = r.breakdown;
  const rows = [
    ['Skills match', b.skills.score, `${b.skills.matched.length} of ${b.skills.matched.length + b.skills.missing.length} key skills found`],
    ['Experience', b.experience.score, `${b.experience.years} year${b.experience.years === 1 ? '' : 's'} detected`],
    ['Education', b.education.score, b.education.level],
    ['Certifications', b.certifications.score, b.certifications.matched.length ? b.certifications.matched.join(', ') : 'None detected'],
    ['Completeness', b.completeness.score, Object.entries(b.completeness.checks).map(([k, v]) => `${v ? '✓' : '✗'} ${k}`).join('  ·  ')]
  ];
  return `<div class="bars">${rows.map(([l, v, ev]) => `
    <div class="bar-row"><span>${l}</span><div class="bar"><i style="width:${v}%"></i></div><b>${v}</b><div class="ev">${esc(ev)}</div></div>`).join('')}</div>
    ${withSkills ? `<div style="margin-top:1.2rem"><div class="section-label">Skills we looked for</div>
      <div class="chips">${b.skills.matched.map(s => `<span class="chip ok" title="Found: ${esc(s.evidence)}">✓ ${esc(s.name)}</span>`).join('')}
      ${b.skills.missing.map(s => `<span class="chip no">${esc(s)}</span>`).join('')}</div></div>` : ''}`;
}

function renderResume() {
  const c = S.me, r = c.resume;
  const locked = !!c.result;
  $('#view').innerHTML = `
    <p class="lead">We read your resume automatically and score it against the role: skills, experience, education and certifications. You'll see exactly what was detected.</p>
    <div class="grid2">
      <div class="card">
        <h3>${r ? 'Replace your resume' : 'Upload your resume'}</h3>
        <p class="muted" style="margin-bottom:14px">PDF, DOCX or TXT · max 5 MB</p>
        <div class="alert error hidden" id="up-err"></div>
        ${locked ? '<div class="alert info">Your application has been assessed, so the resume can no longer be changed.</div>' : `
        <label class="drop" id="drop">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          <b id="drop-label">Drop your file here or click to browse</b>
          <span class="muted" style="font-size:12px">Text-based PDFs work best — scanned images can't be read.</span>
          <input type="file" id="file" accept=".pdf,.docx,.txt" hidden/>
        </label>`}
        ${r ? `<p class="muted" style="font-size:12px;margin-top:12px">Current file: <b>${esc(r.fileName)}</b> · uploaded ${new Date(r.uploadedAt).toLocaleString()}</p>` : ''}
      </div>
      <div class="card">
        ${r ? `
          <div class="score-head">
            <div class="donut" style="--pct:${r.score}"><div><span>${r.score}</span><small>/ 100</small></div></div>
            <div><h3>Resume score</h3><p class="muted">${r.needsReview ? esc(r.note) : 'Scored against the role profile. This counts towards your overall result.'}</p>
            ${c.result ? '' : '<button class="btn sm" style="margin-top:10px" id="to-assess">Continue to the video assessment →</button>'}</div>
          </div>
          ${scoreBars(r)}`
        : '<h3>Your score will appear here</h3><p class="muted">Upload your resume to see the breakdown.</p>'}
      </div>
    </div>`;
  const toAssess = $('#to-assess'); if (toAssess) toAssess.onclick = () => go('assessment');
  if (locked) return;
  const drop = $('#drop'), file = $('#file');
  const send = async f => {
    if (!f) return;
    $('#drop-label').textContent = `Reading ${f.name}…`;
    const fd = new FormData(); fd.append('resume', f);
    try { await api('/api/resume', { body: fd }); await refresh(); renderResume(); }
    catch (e) { $('#up-err').textContent = e.message; $('#up-err').classList.remove('hidden'); $('#drop-label').textContent = 'Drop your file here or click to browse'; }
  };
  file.onchange = () => send(file.files[0]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); send(e.dataTransfer.files[0]); };
}

// ------------------------------------------------------------------ assessment grid
function moduleStatus(m) {
  if (m.locked) return ['locked', 'Locked'];
  if (m.completed) return ['done', 'Completed'];
  if (m.maxWatched > 0) return ['progress', 'In progress'];
  return ['start', 'Not started'];
}

function renderAssessment() {
  const c = S.me;
  $('#view').innerHTML = `
    ${!c.resume ? '<div class="alert info">Upload your resume first — the videos unlock once it has been scored.</div>' : ''}
    ${c.result ? '<div class="alert ok">Assessment complete. You can rewatch any video, but answers can no longer be changed.</div>' : ''}
    <p class="lead">Five short videos, in order. Each one pauses at <b>3 questions</b> — answer to continue. You can't skip ahead past an unanswered question, and each question has one attempt.</p>
    <div class="mod-grid">${S.modules.map((m, i) => {
      const [cls, label] = moduleStatus(m);
      const answered = m.checkpoints.filter(cp => cp.answered).length;
      return `<div class="mod-card ${m.locked ? 'locked' : ''}" data-id="${m.id}">
        <div class="mod-banner" style="--c:${COLORS[m.id] || 'var(--navy-mid)'}">${m.locked ? `<div class="lock">${ICON_LOCK}</div>` : ''}
          <div class="mod-num">Video ${String(i + 1).padStart(2, '0')}</div><div class="mod-title">${esc(m.title)}</div></div>
        <div class="mod-body">
          <div class="chips">${m.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
          <div class="mod-meta">${fmt(m.durationSec)} min · ${answered}/${m.checkpoints.length} questions answered</div>
          <span class="status ${cls}">${label}</span>
        </div></div>`;
    }).join('')}</div>`;
  $$('.mod-card').forEach(card => card.onclick = () => {
    const m = S.modules.find(x => x.id === card.dataset.id);
    if (!m.locked) go('module', m.id);
  });
}

// ------------------------------------------------------------------ player
function stopPlayer() {
  const P = S.player;
  if (!P) return;
  clearInterval(P.timer); clearInterval(P.sync);
  if (P.video) P.video.pause();
  if (!P.finished && P.maxWatched > 0 && !S.me?.result) api(`/api/modules/${P.m.id}/progress`, { body: { position: P.maxWatched } }).catch(() => {});
  S.player = null;
}

function renderModule(id) {
  const m = S.modules.find(x => x.id === id);
  const idx = S.modules.indexOf(m);
  const P = S.player = {
    m, pos: m.completed ? 0 : m.maxWatched, maxWatched: m.completed ? m.durationSec : m.maxWatched,
    playing: false, speed: 1, timer: null, sync: null, overlay: false, finished: false, video: null
  };
  const answered = cp => !!cp.answered;
  const nextCp = () => m.checkpoints.find(cp => !answered(cp));

  $('#view').innerHTML = `
    <div class="player-layout">
      <div>
        <div class="player" id="player" style="--c:${COLORS[m.id] || 'var(--navy-mid)'}">
          ${m.videoUrl ? `<video id="video" src="${esc(m.videoUrl)}" playsinline preload="metadata"></video>`
                       : '<div class="slide"><div class="k" id="sl-k"></div><h2 id="sl-h"></h2><p id="sl-p"></p></div>'}
          <button class="big-play" id="big-play" aria-label="Play">${PLAY.replace('currentColor', 'white')}</button>
          <div class="cp-overlay hidden" id="overlay"></div>
        </div>
        <div class="controls">
          <button class="ctl" id="pp" aria-label="Play / pause">${PLAY}</button>
          <span class="time" id="time"></span>
          <div class="track" id="track"><div class="watched" id="watched"></div><div class="fill" id="fill"></div>
            ${m.checkpoints.map(cp => `<div class="cp ${answered(cp) ? 'ans' : ''}" data-cp="${cp.id}" style="left:${(cp.at / m.durationSec) * 100}%" title="Question"></div>`).join('')}
          </div>
          <select class="speed" id="speed" aria-label="Playback speed"><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
        </div>
        <div class="vp-title">Video ${idx + 1}: ${esc(m.title)}</div>
        <p class="muted" style="font-size:12.5px">The video pauses automatically at each question marker. You can rewind, but not skip past a question you haven't answered.</p>
        <div id="done-box" style="margin-top:1rem"></div>
      </div>
      <div>
        <div class="list-card">
          <div class="hd">Questions in this video</div>
          <div id="q-list"></div>
        </div>
        <div class="list-card" style="margin-top:1rem">
          <div class="hd">All videos</div>
          ${S.modules.map((x, i) => `<div class="li" style="${x.locked ? 'color:var(--muted)' : 'cursor:pointer'}" data-mod="${x.locked ? '' : x.id}">
            <span class="ring ${x.completed ? 'done' : x.id === m.id ? 'cur' : ''}">${x.completed ? '✓' : i + 1}</span>${esc(x.title)}</div>`).join('')}
        </div>
      </div>
    </div>`;
  $$('[data-mod]').forEach(el => el.dataset.mod && (el.onclick = () => go('module', el.dataset.mod)));

  P.video = $('#video');
  const dur = m.durationSec;

  function renderQList() {
    $('#q-list').innerHTML = m.checkpoints.map((cp, i) => {
      const a = cp.answered;
      const ring = !a ? '' : a.correct === undefined ? 'done' : a.correct ? 'done' : 'x';
      const mark = !a ? i + 1 : a.correct === false ? '✗' : '✓';
      return `<div class="li"><span class="ring ${ring}">${mark}</span><span style="flex:1">${a ? esc(cp.question) : `Question at ${fmt(cp.at)}`}</span></div>`;
    }).join('');
    $$('#track .cp').forEach(el => el.classList.toggle('ans', !!m.checkpoints.find(c => c.id === el.dataset.cp).answered));
  }

  function draw() {
    $('#time').textContent = `${fmt(P.pos)} / ${fmt(dur)}`;
    $('#fill').style.width = `${(P.pos / dur) * 100}%`;
    $('#watched').style.width = `${(P.maxWatched / dur) * 100}%`;
    $('#pp').innerHTML = P.playing ? PAUSE : PLAY;
    $('#big-play').classList.toggle('hidden', P.playing || P.overlay);
    if (!m.videoUrl) {
      const ch = [...m.chapters].reverse().find(c => P.pos >= c.at) || m.chapters[0];
      $('#sl-k').textContent = `${m.title} · Part ${m.chapters.indexOf(ch) + 1} of ${m.chapters.length}`;
      $('#sl-h').textContent = ch.title;
      $('#sl-p').textContent = ch.text;
    }
  }

  function setPos(t) {
    P.pos = Math.min(Math.max(t, 0), dur);
    if (P.video && Math.abs(P.video.currentTime - P.pos) > 0.3) P.video.currentTime = P.pos;
  }

  function tick(t) {
    const cp = nextCp();
    if (cp && t >= cp.at) { setPos(cp.at); P.maxWatched = Math.max(P.maxWatched, cp.at); pause(); draw(); return askQuestion(cp); }
    P.pos = Math.min(t, dur);
    P.maxWatched = Math.max(P.maxWatched, P.pos);
    if (P.pos >= dur) { pause(); draw(); return finish(); }
    draw();
  }

  function play() {
    if (P.overlay) return;
    if (P.pos >= dur) setPos(0);
    P.playing = true;
    if (P.video) { P.video.playbackRate = P.speed; P.video.play().catch(() => { P.playing = false; draw(); }); }
    else { const step = 0.25; P.timer = setInterval(() => tick(P.pos + step * P.speed), step * 1000); }
    if (!S.me.result) P.sync = setInterval(() => api(`/api/modules/${m.id}/progress`, { body: { position: P.maxWatched } }).catch(() => {}), 5000);
    draw();
  }
  function pause() {
    P.playing = false;
    clearInterval(P.timer); clearInterval(P.sync);
    if (P.video) P.video.pause();
    draw();
  }

  if (P.video) {
    P.video.addEventListener('timeupdate', () => { if (P.playing) tick(P.video.currentTime); });
    P.video.addEventListener('seeking', () => { if (P.video.currentTime > P.maxWatched + 0.5) P.video.currentTime = P.maxWatched; });
    P.video.addEventListener('ended', () => tick(dur));
    P.video.addEventListener('click', () => (P.playing ? pause() : play()));
  }
  $('#pp').onclick = () => (P.playing ? pause() : play());
  $('#big-play').onclick = play;
  $('#speed').onchange = e => { P.speed = Number(e.target.value); if (P.video) P.video.playbackRate = P.speed; if (P.playing && !P.video) { pause(); play(); } };
  $('#track').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * dur;
    setPos(Math.min(t, P.maxWatched)); draw();
  };

  async function askQuestion(cp) {
    P.overlay = true; draw();
    try { await api(`/api/modules/${m.id}/progress`, { body: { position: cp.at } }); } catch (e) { /* retried on submit */ }
    const n = m.checkpoints.indexOf(cp) + 1;
    const ov = $('#overlay');
    ov.classList.remove('hidden');
    ov.innerHTML = `<div class="cp-box" role="dialog" aria-label="Question">
      <div class="cp-label">Question ${n} of ${m.checkpoints.length} · ${fmt(cp.at)}</div>
      <div class="cp-q">${esc(cp.question)}</div>
      <div class="cp-opts">${cp.options.map((o, i) => `<button class="cp-opt" data-i="${i}"><span class="l">${'ABCD'[i] || i + 1}</span>${esc(o)}</button>`).join('')}</div>
      <div class="alert error hidden" id="cp-err"></div>
      <button class="btn dark block" id="cp-submit" disabled>Submit answer</button>
      <p class="muted" style="font-size:11.5px;text-align:center;margin-top:8px">One attempt only. Your answer is saved immediately.</p>
    </div>`;
    let choice = null;
    $$('.cp-opt', ov).forEach(b => b.onclick = () => {
      choice = Number(b.dataset.i);
      $$('.cp-opt', ov).forEach(x => x.classList.toggle('sel', x === b));
      $('#cp-submit').disabled = false;
    });
    $('#cp-submit').onclick = async () => {
      $('#cp-submit').disabled = true;
      try {
        const r = await api(`/api/modules/${m.id}/checkpoints/${cp.id}`, { body: { choice } });
        cp.answered = { choice, correct: r.correct, explanation: r.explanation };
        $$('.cp-opt', ov).forEach(x => x.disabled = true);
        if (r.correct !== undefined) {
          $(`.cp-opt[data-i="${r.correctIndex}"]`, ov).classList.add('right');
          if (!r.correct) $(`.cp-opt[data-i="${choice}"]`, ov).classList.add('wrong');
        }
        const box = $('#cp-err');
        box.className = `alert ${r.correct === false ? 'error' : 'ok'}`;
        box.textContent = r.correct === undefined ? 'Answer recorded.' : `${r.correct ? 'Correct!' : 'Not quite.'} ${r.explanation || ''}`;
        renderQList();
        const btn = $('#cp-submit');
        btn.textContent = 'Continue video →'; btn.disabled = false;
        btn.onclick = () => { ov.classList.add('hidden'); P.overlay = false; play(); };
      } catch (e) {
        $('#cp-err').textContent = e.message; $('#cp-err').classList.remove('hidden');
        $('#cp-submit').disabled = false;
      }
    };
  }

  async function finish() {
    if (m.completed || S.me.result) return showDone();
    if (nextCp()) return;
    try {
      await api(`/api/modules/${m.id}/progress`, { body: { position: dur } });
      const r = await api(`/api/modules/${m.id}/complete`, { method: 'POST' });
      P.finished = true;
      await refresh();
      if (r.allDone) return go('results');
      showDone();
    } catch (e) { $('#done-box').innerHTML = `<div class="alert error">${esc(e.message)}</div>`; }
  }

  function showDone() {
    const next = S.modules[idx + 1];
    $('#done-box').innerHTML = `<div class="card" style="background:var(--success-bg);border-color:#B7E0C6;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <span style="color:var(--success);width:30px;height:30px">${ICON_CHECK}</span>
      <div style="flex:1"><h3>Video complete</h3><p class="muted">${next ? 'The next video is now unlocked.' : 'That was the last video.'}</p></div>
      ${next ? '<button class="btn" id="next-mod">Next video →</button>' : '<button class="btn" id="to-results">See your results →</button>'}</div>`;
    const n = $('#next-mod'); if (n) n.onclick = () => go('module', next.id);
    const t = $('#to-results'); if (t) t.onclick = () => go('results');
  }

  if (P.video) P.video.currentTime = P.pos;
  renderQList(); draw();
  if (m.completed) showDone();
}

// ------------------------------------------------------------------ results
function renderResults() {
  const c = S.me, r = c.result;
  if (!r) {
    const done = S.modules.filter(m => m.completed).length;
    $('#view').innerHTML = `<div class="card"><h3>Results aren't ready yet</h3>
      <p class="muted" style="margin-bottom:14px">${!c.resume ? 'Upload your resume and complete' : `You've completed ${done} of ${S.modules.length} videos. Finish`} the video assessment to get your result.</p>
      <button class="btn" id="cta">${!c.resume ? 'Upload resume' : 'Continue assessment'} →</button></div>`;
    $('#cta').onclick = () => go(c.resume ? 'assessment' : 'resume');
    return;
  }
  const copy = {
    shortlisted: ['Congratulations — you\'re through to the final interview!', 'Our team will contact you shortly by email or phone to arrange a time.'],
    review: ['Thanks — your application is being reviewed', 'A member of our recruitment team will look at your application and be in touch.'],
    not_progressed: ['Thank you for completing the assessment', 'On this occasion we won\'t be progressing your application. We\'ll keep your details on file for future roles.']
  }[r.status];
  $('#view').innerHTML = `
    <div class="verdict ${r.status}">${r.status === 'shortlisted' ? ICON_CHECK : ICON_INFO}
      <div><h2>${copy[0]}</h2><p>${copy[1]}</p></div></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${r.finalScore}<small style="font-size:16px;color:var(--muted)">/100</small></div><div class="l">Overall score</div></div>
      <div class="kpi"><div class="v">${r.resumeScore}</div><div class="l">Resume score</div></div>
      <div class="kpi"><div class="v">${r.assessmentScore}</div><div class="l">Assessment score</div></div>
      <div class="kpi"><div class="v">${r.assessment.correct}/${r.assessment.total}</div><div class="l">Questions correct</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Assessment by video</h3>
        <div class="bars">${r.assessment.perModule.map(p => `<div class="bar-row"><span>${esc(p.title)}</span><div class="bar"><i style="width:${(p.correct / p.total) * 100}%"></i></div><b>${p.correct}/${p.total}</b></div>`).join('')}</div>
      </div>
      <div class="card"><h3>Resume breakdown</h3>${c.resume ? scoreBars(c.resume, false) : ''}</div>
    </div>
    <p class="muted" style="font-size:12px;margin-top:1rem">Results issued ${new Date(r.evaluatedAt).toLocaleString()}. A copy has been sent to ${esc(c.email)}.</p>`;
}

boot();
