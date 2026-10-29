# ASC Metals — Candidate Screening Portal

A candidate portal that screens job applicants automatically:

1. **Sign up.** The candidate creates an account.
2. **Resume upload.** The candidate uploads a PDF, DOCX or TXT resume. It is read straight away and scored 0–100 against the role profile (skills, experience, education, certifications, completeness), and the candidate sees the breakdown.
3. **Video assessment.** Five training videos unlock in order. Each video **pauses automatically at question markers** and the candidate answers on the spot. There is one attempt per question, and they can't skip past a question they haven't answered (enforced on the server, not just in the browser).
4. **Results.** When the last video is finished, the resume and assessment scores are combined. The candidate is automatically **shortlisted for the final interview**, sent for **review**, or **not progressed**. They see the result right away and a notification is queued.

Recruiters use `/admin.html` to see every candidate with their scores. They can filter by shortlist or review, look at the resume evidence and each answer, download the resume, override a decision, change the scoring rules and export a CSV.

The visual design follows the original *ASC Metals Training Portal* prototype.

## Run it

```bash
npm install
ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='a-strong-password' npm start
# Candidates:  http://localhost:3000
# Recruiters:  http://localhost:3000/admin.html
```

Without `ADMIN_EMAIL` / `ADMIN_PASSWORD` an admin account `admin@example.com` / `change-me-now` is created on first start. Change it before going live.

```bash
npm test     # resume scoring + full candidate journey (API level)
```

## Configure

| What | Where |
|---|---|
| Videos, chapters and questions | `config/courses.json` |
| Role profile, score weights, shortlist thresholds | `config/screening.json` (defaults), editable in **Admin → Scoring rules** |
| Data (accounts, scores, uploaded resumes, outbox) | `data/` (set `DATA_DIR` to move it) |

**Adding real videos.** In `config/courses.json`, set each module's `videoUrl` to a hosted MP4 and `durationSec` to its real length, then set each question's `at` (seconds) to where the video should pause. Until a `videoUrl` is set, the module plays the built-in narrated-slide player (driven by `chapters`), so the whole flow can be demoed without footage. Correct answers (`answerIndex`) are never sent to the browser.

**How the decision is made** (all numbers are editable):

- Overall = 40% resume + 60% assessment
- **Shortlisted:** overall ≥ 70, resume ≥ 40 and assessment ≥ 60
- **Review:** overall ≥ 55 (or the resume could not be read, e.g. a scanned image)
- **Not progressed:** everything else

A recruiter override always wins over the automatic decision. **Re-score everyone** applies changed rules to existing candidates and keeps manual decisions.

## Production checklist

- **Email:** `src/notify.js` writes messages to `data/outbox.jsonl`. Connect SMTP, SendGrid, SES or similar in `send()`.
- **Database:** `src/db.js` is a JSON-file store, fine for a pilot. Move to Postgres or SQLite for larger volumes or more than one server.
- **Hosting:** put the app behind HTTPS and set `NODE_ENV=production` so cookies are marked `Secure`. Store resumes on encrypted storage, and add login rate limiting.
- **Video hosting:** use a CDN or a video platform that serves MP4.
- **Compliance:** add a privacy notice and consent text for processing CVs, plus a retention policy (GDPR).
