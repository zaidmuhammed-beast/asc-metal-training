'use strict';
// Resume text extraction + rule-based scoring against the role profile in
// config/screening.json. Every number comes with the evidence behind it so
// candidates and recruiters can see why a score was given.
const path = require('path');

const ALLOWED = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain'
};

async function extractText(buffer, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.pdf') {
    // Require the library file directly: pdf-parse's index.js runs a self-test.
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    return (await pdfParse(buffer)).text || '';
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ buffer })).value || '';
  }
  if (ext === '.txt') return buffer.toString('utf8');
  throw new Error('Unsupported file type. Please upload a PDF, DOCX or TXT file.');
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Word-boundary match that also works for keywords like "h&s" or "c++".
const hasKeyword = (text, kw) => new RegExp(`(^|[^a-z0-9])${escapeRe(kw.toLowerCase())}`, 'i').test(text);

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';

function detectExperienceYears(text, now = new Date()) {
  const nowYears = now.getFullYear() + now.getMonth() / 12;
  // Date ranges like "Mar 2019 – Present", "2016 - 2020", "06/2018 to 09/2021"
  const range = new RegExp(
    `(?:${MONTH_RE}\\s*|(\\d{1,2})\\/)?((?:19|20)\\d{2})\\s*(?:-|–|—|to|until)\\s*` +
    `(?:(?:${MONTH_RE}\\s*|(\\d{1,2})\\/)?((?:19|20)\\d{2})|(present|current|now|date|today))`, 'gi');
  const spans = [];
  let m;
  while ((m = range.exec(text))) {
    const startMonth = m[1] ? MONTHS[m[1].slice(0, 3).toLowerCase()] : m[2] ? Number(m[2]) - 1 : 0;
    const start = Number(m[3]) + Math.min(Math.max(startMonth, 0), 11) / 12;
    let end;
    if (m[7]) end = nowYears;
    else {
      const endMonth = m[4] ? MONTHS[m[4].slice(0, 3).toLowerCase()] : m[5] ? Number(m[5]) - 1 : 11;
      end = Number(m[6]) + (Math.min(Math.max(endMonth, 0), 11) + 1) / 12; // end month is inclusive
    }
    if (end > start && end <= nowYears + 1 && end - start < 50) spans.push([start, Math.min(end, nowYears)]);
  }
  // Merge overlapping spans so concurrent roles are not double counted.
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0, cur = null;
  for (const s of spans) {
    if (!cur || s[0] > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [...s]; }
    else cur[1] = Math.max(cur[1], s[1]);
  }
  if (cur) total += cur[1] - cur[0];

  // Explicit statements like "5+ years of experience"
  let stated = 0;
  const statedRe = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b(?:\s+of)?(?:\s+\w+){0,3}?\s+experience/gi;
  while ((m = statedRe.exec(text))) stated = Math.max(stated, Number(m[1]));

  return Math.round(Math.min(Math.max(total, stated), 45) * 10) / 10;
}

function scoreResume(rawText, profile) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const wordCount = text ? text.split(' ').length : 0;

  if (wordCount < 25) {
    return {
      score: 0, needsReview: true, wordCount,
      note: 'Very little text could be read from this file (it may be a scanned image). A recruiter will review it manually.',
      breakdown: null
    };
  }

  // Skills
  const totalSkillWeight = profile.skills.reduce((s, k) => s + k.weight, 0) || 1;
  const matched = [], missing = [];
  let skillWeight = 0;
  for (const skill of profile.skills) {
    const hit = skill.keywords.find(kw => hasKeyword(lower, kw));
    if (hit) { matched.push({ name: skill.name, evidence: hit }); skillWeight += skill.weight; }
    else missing.push(skill.name);
  }
  const skills = { score: Math.round((skillWeight / totalSkillWeight) * 100), matched, missing };

  // Experience
  const years = detectExperienceYears(text);
  const experience = { score: Math.round(Math.min(years / (profile.idealYears || 1), 1) * 100), years };

  // Education (highest level found)
  const edu = profile.education.find(level => level.keywords.some(kw => hasKeyword(lower, kw)));
  const education = { score: edu ? edu.points : 0, level: edu ? edu.level : 'Not detected' };

  // Certifications
  const certs = profile.certifications.keywords.filter(kw => hasKeyword(lower, kw));
  const certifications = { score: Math.min(100, certs.length * profile.certifications.pointsEach), matched: certs };

  // Completeness
  const checks = {
    email: /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text),
    phone: /(\+?\d[\d\s().-]{8,}\d)/.test(text),
    detail: wordCount >= 150
  };
  const completeness = { score: Math.round((Object.values(checks).filter(Boolean).length / 3) * 100), checks };

  const parts = { skills, experience, education, certifications, completeness };
  const w = profile.weights;
  const totalW = Object.keys(parts).reduce((s, k) => s + (w[k] || 0), 0) || 1;
  const score = Math.round(Object.entries(parts).reduce((s, [k, p]) => s + p.score * (w[k] || 0), 0) / totalW);

  return { score, needsReview: false, wordCount, breakdown: parts };
}

module.exports = { ALLOWED, extractText, scoreResume, detectExperienceYears };
