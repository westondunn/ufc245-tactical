/**
 * auth/email.js — Mail dispatch.
 *
 * Currently a dev stub: writes each message to tmp/mail/<timestamp>-<to>.txt
 * and logs the subject + recipient. Verification + reset flows go through here
 * via the better-auth callbacks wired in auth/index.js.
 *
 * To ship verification/reset for real, swap the body of sendMail() for a Resend
 * (or SES, Postmark, etc.) call and add the credentials to .env. Keep the
 * stub as a fallback when MAIL_PROVIDER is unset so dev continues to work.
 */
const fs = require('fs');
const path = require('path');

const MAIL_DIR = path.join(__dirname, '..', 'tmp', 'mail');

function safePart(s) {
  return String(s || 'unknown').replace(/[^a-z0-9._-]/gi, '_').slice(0, 60);
}

async function sendMail({ to, subject, html, text }) {
  // TODO: when wiring a real provider, branch on process.env.MAIL_PROVIDER:
  //   if ('resend') { await resend.emails.send({...}); return; }
  // The dev stub below stays as the fallback when the env var is unset.
  fs.mkdirSync(MAIL_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(MAIL_DIR, `${stamp}-${safePart(to)}.txt`);
  const body = [
    `TO: ${to}`,
    `SUBJECT: ${subject}`,
    '',
    html || text || '(empty body)',
  ].join('\n');
  fs.writeFileSync(file, body);
  console.log(`[mail] ${subject} → ${to}  (saved: ${path.relative(process.cwd(), file)})`);
  return { ok: true, file };
}

module.exports = { sendMail, MAIL_DIR };
