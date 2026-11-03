// services/makeupEmails.js
// DM3A Make-up — the THREE fixed emails that go to students automatically
// (docs/makeup-module-spec.md §2): approved (with the personal link), denied
// (office hours), and the question. Every other message to a student is a
// draft the instructor approves (v1).
//
// TEMPLATES_APPROVED: Ralph OKed the exact wording on 2026-11-03. Set it to false
// to stop all three: the routes still work, the instructor sees "email not sent"
// on the request, and can copy the personal link by hand.
//
// Logs carry the request id and email kind only — never the address, the name,
// the question or the link.

const { getResend } = require('../lib/clients.js');

const TEMPLATES_APPROVED = true; // Ralph approved the wording 2026-11-03
const FROM = 'DM3A Grader <support@dm3agrader.com>';
const SIGNATURE = '— Dr. Ralph Minaya';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
const fmtDateTime = (d) =>
  new Date(d).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short',
  });

// Each template → { subject, text } from plain values. HTML is derived from the
// text so the two never drift apart.
const TEMPLATES = {
  approved: ({ firstName, course, assignment, link, endDate }) => ({
    subject: `Video make-up approved — ${course} ${assignment}`,
    text: [
      `Hi ${firstName},`,
      '',
      `Your request for a video make-up for **${assignment}** in **${course}** is approved.`,
      '',
      `Your personal link: ${link}`,
      `It works on your phone or laptop and expires on **${fmtDate(endDate)}**. It's only for you, so please don't share it.`,
      '',
      '**What to do:**',
      '1. Open the link and choose the assignment.',
      '2. Upload a clear photo of your completed written work.',
      '3. One question about your own work appears right away. It is also emailed to you. You have **24 hours** to answer it.',
      '4. Record a Loom video. Point at your paper and explain each step in order. **At the end, answer the question.**',
      '5. Open the same link again and paste your Loom link and the Loom transcript.',
      '',
      SIGNATURE,
    ].join('\n'),
  }),

  denied: ({ firstName, course, assignment }) => ({
    subject: `Your make-up request — ${course} ${assignment}`,
    text: [
      `Hi ${firstName},`,
      '',
      `Thank you for your request about **${assignment}** in **${course}**. I can't approve a video make-up for this one. Please come to my **office hours, Monday, Wednesday and Friday, 11:00 AM–12:00 PM**, and we'll work through it together.`,
      '',
      SIGNATURE,
    ].join('\n'),
  }),

  question: ({ firstName, course, assignment, question, expiresAt, link }) => ({
    subject: `Your make-up question — ${course} ${assignment}`,
    text: [
      `Hi ${firstName},`,
      '',
      `Here is your question about your own work on **${assignment}**:`,
      '',
      `**${question}**`,
      '',
      `Answer it **at the end of your Loom video**, after you explain each step on your paper. You have until **${fmtDateTime(expiresAt)}** (24 hours from when the question appeared).`,
      '',
      `When you're done, paste your Loom link and transcript on your personal link: ${link}`,
      '',
      SIGNATURE,
    ].join('\n'),
  }),
};

function toHtml(text) {
  const body = esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .split('\n')
    .join('<br>');
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;line-height:1.5;">${body}</div>`;
}

function render(kind, vars) {
  const t = TEMPLATES[kind](vars);
  return { subject: t.subject, text: t.text.replace(/\*\*/g, ''), html: toHtml(t.text) };
}

// → { sent: boolean, reason? }. Never throws: a mail failure must not undo the
// approval/denial/question the instructor or student just made.
async function sendStudentEmail(kind, { to, requestId, ...vars }) {
  if (!TEMPLATES[kind]) return { sent: false, reason: 'unknown template' };
  if (!TEMPLATES_APPROVED) {
    console.log(`[makeup] email "${kind}" for request ${requestId} not sent: templates awaiting approval`);
    return { sent: false, reason: 'templates awaiting approval' };
  }
  const mailer = getResend();
  if (!mailer) {
    console.log(`[makeup] email "${kind}" for request ${requestId} not sent: no mail key (dev)`);
    return { sent: false, reason: 'no mail key' };
  }
  try {
    const { subject, text, html } = render(kind, vars);
    await mailer.emails.send({ from: FROM, to, subject, text, html });
    console.log(`[makeup] email "${kind}" sent for request ${requestId}`);
    return { sent: true };
  } catch (err) {
    console.error(`[makeup] email "${kind}" for request ${requestId} failed:`, err.message);
    return { sent: false, reason: 'send failed' };
  }
}

module.exports = { sendStudentEmail, render, TEMPLATES_APPROVED };
