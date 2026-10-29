'use strict';
// Outbound notifications. Messages are saved under outbox/ in storage so they
// can be inspected; plug an email provider (SMTP, SendGrid, SES…) into send().
const crypto = require('crypto');
const store = require('./store');

async function send(to, subject, body) {
  const msg = { to, subject, body, at: new Date().toISOString() };
  await store.set(`outbox/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`, msg);
  if (process.env.NODE_ENV !== 'test') console.log(`[notify] → ${to}: ${subject}`);
}

module.exports = { send };
