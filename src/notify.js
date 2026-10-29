'use strict';
// Outbound notifications. Messages are written to data/outbox.jsonl so they can
// be inspected; plug an email provider (SMTP, SendGrid, SES…) into send().
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

function send(to, subject, body) {
  const msg = { to, subject, body, at: new Date().toISOString() };
  fs.appendFileSync(path.join(DATA_DIR, 'outbox.jsonl'), JSON.stringify(msg) + '\n');
  if (process.env.NODE_ENV !== 'test') console.log(`[notify] → ${to}: ${subject}`);
}

module.exports = { send };
