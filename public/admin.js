'use strict';
// Recruiter dashboard.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dash = v => (v === null || v === undefined ? '—' : v);

async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (opts.body) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.status = res.status; throw e; }
  return data;
}

const STAGES = { registered: 'Registered', resume_submitted: 'Resume in', assessment: 'Assessment', completed: 'Completed' };
const S = { list: [], labels: {}, filter: 'all', q: '', sort: ['finalScore', -1] };

$('#login').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('[data-err]', f);
  try {
    const r = await api('/api/auth/login', { body: { email: f.email.value, password: f.password.value } });
    if (r.role !== 'admin') { await api('/api/auth/logout', { method: 'POST' }); throw new Error('This account is not a recruiter account.'); }
    boot();
  } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
});
$('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); };
$$('.nav-item[data-view]').forEach(n => n.onclick = () => go(n.dataset.view));

async function boot() {
  try { await load(); }
  catch (e) { $('#auth').classList.remove('hidden'); $('#app').classList.add('hidden'); return; }
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  go('candidates');
}

async function load() {
  const r = await api('/api/admin/candidates');
  S.list = r.candidates; S.labels = r.statusLabels;
}

function go(view) {
  $$('.nav-item[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $('#tb-title').textContent = view === 'settings' ? 'Scoring rules' : 'Candidates';
  (view === 'settings' ? renderSettings : renderCandidates)();
}

// ------------------------------------------------------------------ list
function renderCandidates() {
  const L = S.list;
  const count = st => L.filter(c => c.status === st).length;
  const completed = L.filter(c => c.finalScore !== null);
  const avg = completed.length ? Math.round(completed.reduce((s, c) => s + c.finalScore, 0) / completed.length) : '—';
  $('#view').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="v">${L.length}</div><div class="l">Candidates</div></div>
      <div class="kpi"><div class="v">${completed.length}</div><div class="l">Completed assessment</div></div>
      <div class="kpi"><div class="v" style="color:var(--success)">${count('shortlisted')}</div><div class="l">Shortlisted for interview</div></div>
      <div class="kpi"><div class="v" style="color:var(--info)">${count('review')}</div><div class="l">Needs review</div></div>
      <div class="kpi"><div class="v">${avg}</div><div class="l">Average overall score</div></div>
    </div>
    <div class="toolbar">
      <div class="tabs" id="tabs">${[['all', 'All'], ['shortlisted', 'Shortlisted'], ['review', 'Review'], ['not_progressed', 'Not progressed'], ['pending', 'In progress']]
        .map(([k, l]) => `<button data-f="${k}" class="${S.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input class="search" id="q" placeholder="Search name, email, town…" value="${esc(S.q)}"/>
      <button class="btn sm ghost" id="reload">Refresh</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${[['name', 'Candidate'], ['stage', 'Stage'], ['resumeScore', 'Resume'], ['assessmentScore', 'Assessment'], ['finalScore', 'Overall'], ['status', 'Status'], ['createdAt', 'Applied']]
        .map(([k, l]) => `<th data-k="${k}">${l}${S.sort[0] === k ? (S.sort[1] > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody id="rows"></tbody></table></div>`;
  $$('#tabs button').forEach(b => b.onclick = () => { S.filter = b.dataset.f; renderCandidates(); });
  $('#q').oninput = e => { S.q = e.target.value; drawRows(); };
  $('#reload').onclick = async () => { await load(); renderCandidates(); };
  $$('th[data-k]').forEach(th => th.onclick = () => {
    S.sort = [th.dataset.k, S.sort[0] === th.dataset.k ? -S.sort[1] : -1]; renderCandidates();
  });
  drawRows();
}

function drawRows() {
  const q = S.q.trim().toLowerCase();
  const [k, dir] = S.sort;
  const val = c => k === 'name' ? `${c.firstName} ${c.lastName}`.toLowerCase() : c[k] ?? -1;
  const rows = S.list
    .filter(c => S.filter === 'all' || (S.filter === 'pending' ? !c.status : c.status === S.filter))
    .filter(c => !q || [c.firstName, c.lastName, c.email, c.location].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  $('#rows').innerHTML = rows.length ? rows.map(c => `
    <tr data-id="${c.id}">
      <td><b>${esc(c.firstName)} ${esc(c.lastName)}</b><div class="muted" style="font-size:12px">${esc(c.email)}</div></td>
      <td>${STAGES[c.stage]}${c.stage === 'assessment' ? ` <span class="muted">(${c.answered}/${c.totalQuestions})</span>` : ''}</td>
      <td class="num">${dash(c.resumeScore)}${c.needsReview ? ' <span title="Resume could not be read">⚠</span>' : ''}</td>
      <td class="num">${dash(c.assessmentScore)}</td>
      <td class="num" style="font-size:15px">${dash(c.finalScore)}</td>
      <td>${c.status ? `<span class="status ${c.status}">${esc(S.labels[c.status])}</span>${c.overridden ? ' <span class="muted" title="Set manually">✎</span>' : ''}` : '<span class="status none">Pending</span>'}</td>
      <td class="muted">${new Date(c.createdAt).toLocaleDateString()}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">No candidates match.</td></tr>';
  $$('#rows tr[data-id]').forEach(tr => tr.onclick = () => openCandidate(tr.dataset.id));
}

// ------------------------------------------------------------------ detail
function closeDrawer() { $('#drawer').classList.add('hidden'); $('#drawer-bg').classList.add('hidden'); }
$('#drawer-bg').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

async function openCandidate(id) {
  const { candidate: c, override, answers } = await api(`/api/admin/candidates/${id}`);
  const r = c.resume, b = r?.breakdown, res = c.result;
  const d = $('#drawer');
  d.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <div class="tag">${STAGES[c.stage]}</div>
    <h2>${esc(c.firstName)} ${esc(c.lastName)}</h2>
    <dl class="dl">
      <dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>
      <dt>Phone</dt><dd>${esc(c.phone) || '—'}</dd>
      <dt>Location</dt><dd>${esc(c.location) || '—'}</dd>
      <dt>Applied for</dt><dd>${esc(c.position)}</dd>
      <dt>Registered</dt><dd>${new Date(c.createdAt).toLocaleString()}</dd>
    </dl>
    ${res ? `<div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="v">${res.finalScore}</div><div class="l">Overall</div></div>
      <div class="kpi"><div class="v">${res.resumeScore}</div><div class="l">Resume</div></div>
      <div class="kpi"><div class="v">${res.assessmentScore}</div><div class="l">Assessment</div></div></div>
      <div class="card" style="padding:1rem 1.2rem"><b>Automatic decision:</b> <span class="status ${res.autoStatus}">${esc(S.labels[res.autoStatus])}</span>
        <ul style="margin:8px 0 0 18px;font-size:12.5px;color:var(--muted)">${res.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}

    <div class="card" style="padding:1rem 1.2rem;margin-top:1rem">
      <div class="section-label">Decision</div>
      <div class="field"><label for="ov-status">Status</label>
        <select id="ov-status"><option value="">Use automatic decision${res ? ` (${esc(S.labels[res.autoStatus])})` : ''}</option>
        ${Object.entries(S.labels).map(([k, l]) => `<option value="${k}" ${override?.status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="ov-note">Note (internal)</label><input id="ov-note" value="${esc(override?.note)}"/></div>
      <label style="font-size:13px;display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" id="ov-notify"/> Email the candidate about this change</label>
      <button class="btn sm" id="ov-save">Save decision</button>
      ${override ? `<p class="muted" style="font-size:12px;margin-top:8px">Set by ${esc(override.by)} on ${new Date(override.at).toLocaleString()}</p>` : ''}
    </div>

    <div class="card" style="padding:1rem 1.2rem">
      <div class="section-label">Resume</div>
      ${r ? `<p style="font-size:13px"><b>${esc(r.fileName)}</b> · score <b>${r.score}</b> · uploaded ${r.uploads}× · <a href="/api/admin/candidates/${c.id}/resume">Download</a></p>
        ${r.needsReview ? `<div class="alert info" style="margin-top:8px">${esc(r.note)}</div>` : ''}
        ${b ? `<div class="bars">${[['Skills', b.skills.score], ['Experience', b.experience.score, `${b.experience.years} yrs`], ['Education', b.education.score, b.education.level], ['Certifications', b.certifications.score, b.certifications.matched.join(', ')], ['Completeness', b.completeness.score]]
          .map(([l, v, ev]) => `<div class="bar-row"><span>${l}</span><div class="bar"><i style="width:${v}%"></i></div><b>${v}</b>${ev ? `<div class="ev">${esc(ev)}</div>` : ''}</div>`).join('')}</div>
        <div class="chips" style="margin-top:12px">${b.skills.matched.map(s => `<span class="chip ok" title="${esc(s.evidence)}">✓ ${esc(s.name)}</span>`).join('')}${b.skills.missing.map(s => `<span class="chip no">${esc(s)}</span>`).join('')}</div>` : ''}`
      : '<p class="muted">Not uploaded yet.</p>'}
    </div>

    <div class="card" style="padding:1rem 1.2rem">
      <div class="section-label">Assessment answers</div>
      ${answers.map(m => `<div style="margin-bottom:10px"><b>${esc(m.title)}</b>
        ${m.questions.map(q => `<div class="qa"><span style="color:${q.correct === null ? 'var(--muted)' : q.correct ? 'var(--success)' : 'var(--danger)'}">${q.correct === null ? '○' : q.correct ? '✓' : '✗'}</span> ${esc(q.question)}
          <div class="muted">Answered: ${q.given ? esc(q.given) : '—'}${q.correct === false ? ` · Correct: ${esc(q.correctAnswer)}` : ''}</div></div>`).join('')}</div>`).join('')}
    </div>`;
  d.classList.remove('hidden'); $('#drawer-bg').classList.remove('hidden');
  $('.close', d).onclick = closeDrawer;
  $('#ov-save').onclick = async () => {
    await api(`/api/admin/candidates/${c.id}/status`, { body: { status: $('#ov-status').value || null, note: $('#ov-note').value, notify: $('#ov-notify').checked } });
    await load(); renderCandidates(); openCandidate(c.id);
  };
}

// ------------------------------------------------------------------ settings
async function renderSettings() {
  const { settings: s } = await api('/api/admin/settings');
  const num = (id, label, v, hint) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" min="0" max="100" value="${v}"/>${hint ? `<span class="muted" style="font-size:11.5px">${hint}</span>` : ''}</div>`;
  $('#view').innerHTML = `
    <p class="lead">These rules decide who is automatically shortlisted. Changes apply to new results; use “Re-score everyone” to apply them to existing candidates (manual decisions are kept).</p>
    <div class="alert hidden" id="msg"></div>
    <div class="grid2">
      <div class="card">
        <h3>Overall score</h3><p class="muted" style="margin-bottom:12px">How much each part counts.</p>
        <div class="row2">${num('w-res', 'Resume weight', s.weights.resume)}${num('w-ass', 'Assessment weight', s.weights.assessment)}</div>
        <h3 style="margin-top:8px">Decision thresholds</h3><p class="muted" style="margin-bottom:12px">Scores are out of 100.</p>
        <div class="row2">${num('t-short', 'Shortlist at or above', s.thresholds.shortlist, 'Invited to final interview')}${num('t-rev', 'Review at or above', s.thresholds.review, 'Below this: not progressed')}</div>
        <div class="row2">${num('t-minr', 'Minimum resume score', s.thresholds.minResume)}${num('t-mina', 'Minimum assessment score', s.thresholds.minAssessment)}</div>
        <label style="font-size:13px;display:flex;gap:8px;align-items:center"><input type="checkbox" id="fb" ${s.showAnswerFeedback ? 'checked' : ''}/> Show candidates whether each answer was correct</label>
      </div>
      <div class="card">
        <h3>Resume profile</h3><p class="muted" style="margin-bottom:12px">Role title, skills/keywords, education levels and certifications used to score resumes (JSON).</p>
        <div class="field"><label for="role">Role title</label><input id="role" value="${esc(s.role)}"/></div>
        <div class="field"><label for="profile">Profile</label><textarea id="profile" spellcheck="false">${esc(JSON.stringify(s.resumeProfile, null, 2))}</textarea></div>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:1.2rem;flex-wrap:wrap">
      <button class="btn" id="save">Save rules</button>
      <button class="btn ghost" id="rescore">Re-score everyone</button>
    </div>`;
  const msg = (t, ok) => { const m = $('#msg'); m.className = `alert ${ok ? 'ok' : 'error'}`; m.textContent = t; window.scrollTo(0, 0); };
  $('#save').onclick = async () => {
    let profile;
    try { profile = JSON.parse($('#profile').value); } catch { return msg('The resume profile is not valid JSON.'); }
    try {
      await api('/api/admin/settings', { method: 'PUT', body: {
        role: $('#role').value,
        weights: { resume: +$('#w-res').value, assessment: +$('#w-ass').value },
        thresholds: { shortlist: +$('#t-short').value, review: +$('#t-rev').value, minResume: +$('#t-minr').value, minAssessment: +$('#t-mina').value },
        showAnswerFeedback: $('#fb').checked,
        resumeProfile: profile
      } });
      msg('Rules saved.', true);
    } catch (e) { msg(e.message); }
  };
  $('#rescore').onclick = async () => {
    const r = await api('/api/admin/reevaluate', { method: 'POST' });
    await load(); msg(`Re-scored ${r.updated} candidates with the current rules.`, true);
  };
}

boot();
