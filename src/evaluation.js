'use strict';
// Combines the resume score and assessment score and decides who moves on
// to the final interview.
const settings = require('./settings');

const STATUS_LABELS = {
  shortlisted: 'Shortlisted for final interview',
  review: 'Under review',
  not_progressed: 'Not progressed'
};

function assessmentScore(candidate) {
  let correct = 0, answered = 0;
  const perModule = settings.courses().map(m => {
    const p = candidate.progress?.[m.id] || {};
    const answers = Object.values(p.answers || {});
    const c = answers.filter(a => a.correct).length;
    correct += c; answered += answers.length;
    return { id: m.id, title: m.title, correct: c, total: m.checkpoints.length, completed: !!p.completed };
  });
  const total = settings.totalCheckpoints();
  return { score: total ? Math.round((correct / total) * 100) : 0, correct, answered, total, perModule };
}

function evaluate(candidate) {
  const cfg = settings.get();
  const resume = candidate.resume?.score ?? 0;
  const assessment = assessmentScore(candidate);
  const wR = cfg.weights.resume, wA = cfg.weights.assessment;
  const finalScore = Math.round((resume * wR + assessment.score * wA) / ((wR + wA) || 1));
  const t = cfg.thresholds;

  const reasons = [];
  if (resume < t.minResume) reasons.push(`Resume score ${resume} is below the minimum of ${t.minResume}.`);
  if (assessment.score < t.minAssessment) reasons.push(`Assessment score ${assessment.score} is below the minimum of ${t.minAssessment}.`);

  let status;
  if (candidate.resume?.needsReview) { status = 'review'; reasons.push('Resume needs a manual read.'); }
  else if (finalScore >= t.shortlist && reasons.length === 0) status = 'shortlisted';
  else if (finalScore >= t.review) status = 'review';
  else status = 'not_progressed';
  if (status === 'shortlisted') reasons.push(`Overall score ${finalScore} meets the shortlist mark of ${t.shortlist}.`);
  else if (finalScore < t.shortlist) reasons.push(`Overall score ${finalScore} is below the shortlist mark of ${t.shortlist}.`);

  return {
    resumeScore: resume,
    assessmentScore: assessment.score,
    assessment,
    finalScore,
    autoStatus: status,
    reasons,
    evaluatedAt: new Date().toISOString()
  };
}

// Admin overrides win over the automatic decision.
const effectiveStatus = c => c.override?.status || c.result?.autoStatus || null;

function stage(c) {
  if (c.result) return 'completed';
  if (Object.values(c.progress || {}).some(p => p.maxWatched > 0)) return 'assessment';
  if (c.resume) return 'resume_submitted';
  return 'registered';
}

module.exports = { evaluate, assessmentScore, effectiveStatus, stage, STATUS_LABELS };
