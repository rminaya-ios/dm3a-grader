// services/alertDispatcher.js
// DM3A Grader — Alert Dispatcher
// Phase 2: Sends alerts via Resend (email) + Telegram (drm3a_bot)
// Drop into: /server/services/alertDispatcher.js

const { Resend } = require('resend');
const axios = require('axios');

const resend    = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'support@dm3agrader.com';
const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID; // your drm3a_bot chat ID

// ─────────────────────────────────────────────────────────────────────────────

/**
 * dispatchAlerts
 * Sends professor email, student email, and Telegram notification
 * for a newly created or escalated AtRiskFlag.
 * Tracks which alerts have already been sent to prevent duplicates.
 *
 * @param {Object} flag - AtRiskFlag mongoose document
 */
const dispatchAlerts = async (flag) => {
  const results = [];

  // ── 1. Professor email ─────────────────────────────────────────────────
  if (!flag.alertsSent.includes('email_professor')) {
    try {
      await sendProfessorAlert(flag);
      flag.alertsSent.push('email_professor');
      results.push('email_professor ✅');
    } catch (err) {
      console.error(`Professor email failed for ${flag.studentEmail}: ${err.message}`);
    }
  }

  // ── 2. Student email ───────────────────────────────────────────────────
  if (!flag.alertsSent.includes('email_student')) {
    try {
      await sendStudentAlert(flag);
      flag.alertsSent.push('email_student');
      results.push('email_student ✅');
    } catch (err) {
      console.error(`Student email failed for ${flag.studentEmail}: ${err.message}`);
    }
  }

  // ── 3. Telegram push ───────────────────────────────────────────────────
  if (!flag.alertsSent.includes('telegram')) {
    try {
      await sendTelegramAlert(flag);
      flag.alertsSent.push('telegram');
      results.push('telegram ✅');
    } catch (err) {
      console.error(`Telegram alert failed: ${err.message}`);
    }
  }

  // ── Save updated alertsSent list ──────────────────────────────────────
  await flag.save();
  console.log(`📣 Alerts dispatched for ${flag.studentEmail}: ${results.join(', ')}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Email: Professor
// ─────────────────────────────────────────────────────────────────────────────

const sendProfessorAlert = async (flag) => {
  const stateLabel    = flag.flagState === 'ACT_NOW' ? '🔴 ACT NOW' : '🟡 WATCH';
  const typeLabel     = flag.flagType === 'academic' ? 'Academic' : 'Behavioral';
  const dashboardUrl  = `${process.env.FRONTEND_URL}/dashboard`;

  await resend.emails.send({
    from:    FROM_EMAIL,
    to:      flag.professorEmail,
    subject: `${stateLabel} — ${flag.studentName} · ${flag.courseCode}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${flag.flagState === 'ACT_NOW' ? '#dc2626' : '#d97706'};">
          ${stateLabel}: ${flag.studentName}
        </h2>
        <table style="border-collapse: collapse; width: 100%;">
          <tr><td style="padding: 6px; font-weight: bold;">Course</td><td>${flag.courseCode}</td></tr>
          <tr><td style="padding: 6px; font-weight: bold;">Signal Type</td><td>${typeLabel} (Rule ${flag.triggerRule})</td></tr>
          <tr><td style="padding: 6px; font-weight: bold;">Details</td><td>${flag.triggerDescription}</td></tr>
          <tr><td style="padding: 6px; font-weight: bold;">Flagged</td><td>${new Date(flag.triggeredAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}</td></tr>
        </table>
        <br/>
        <p style="color: #374151;">
          ${
            flag.flagType === 'academic'
              ? 'A brief check-in email or office hours invitation before the next assignment may significantly reduce withdrawal risk.'
              : 'This student may be disengaging. A personal outreach message sent within 24–48 hours is recommended.'
          }
        </p>
        <a href="${dashboardUrl}" style="
          display: inline-block;
          background: #1d4ed8;
          color: white;
          padding: 10px 20px;
          border-radius: 6px;
          text-decoration: none;
          margin-top: 12px;
        ">Open Dashboard →</a>
        <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
          DM3A Grader · dm3agrader.com<br/>
          A student support email has also been sent to ${flag.studentEmail}.
        </p>
      </div>
    `,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Email: Student (two templates by flagType — never uses "at-risk" language)
// ─────────────────────────────────────────────────────────────────────────────

const sendStudentAlert = async (flag) => {
  const isAcademic = flag.flagType === 'academic';

  const subject = isAcademic
    ? `Checking in — ${flag.courseCode}`
    : `I noticed you haven't submitted yet — ${flag.courseCode}`;

  const bodyHtml = isAcademic
    ? `
      <div style="font-family: sans-serif; max-width: 580px; margin: 0 auto; color: #111827;">
        <p>Hi ${flag.studentName.split(' ')[0]},</p>
        <p>
          Your recent work in <strong>${flag.courseCode}</strong> tells me you're working through
          some challenging material right now. That's completely normal — and it's exactly
          the right time to get some support.
        </p>
        <p>
          I'd like to connect with you before the next assignment to make sure you have
          everything you need to keep moving forward.
        </p>
        <p>You can reach me at:</p>
        <ul>
          <li>📅 <strong>Office Hours:</strong> ${process.env.OFFICE_HOURS || '[See Blackboard for schedule]'}</li>
          <li>📧 <strong>Email:</strong> ${flag.professorEmail}</li>
        </ul>
        <p>Keep going. You're not behind — you're still here, and that matters.</p>
        <p style="margin-top: 24px;">— Dr. Minaya<br/>${flag.courseCode}</p>
      </div>
    `
    : `
      <div style="font-family: sans-serif; max-width: 580px; margin: 0 auto; color: #111827;">
        <p>Hi ${flag.studentName.split(' ')[0]},</p>
        <p>
          I noticed you haven't submitted <strong>${flag.triggerAssignments[0] || 'a recent assignment'}</strong> yet.
          Life gets complicated — I get it.
        </p>
        <p>
          If something is making it hard to keep up right now, I want to know so we can
          figure something out together. A late submission is always better than no submission.
        </p>
        <p>
          Please reach out or submit soon — I'm here to help you stay in this course.
        </p>
        <p>You can reach me at:</p>
        <ul>
          <li>📅 <strong>Office Hours:</strong> ${process.env.OFFICE_HOURS || '[See Blackboard for schedule]'}</li>
          <li>📧 <strong>Email:</strong> ${flag.professorEmail}</li>
        </ul>
        <p style="margin-top: 24px;">— Dr. Minaya<br/>${flag.courseCode}</p>
      </div>
    `;

  await resend.emails.send({
    from:    FROM_EMAIL,
    to:      flag.studentEmail,
    subject,
    html:    bodyHtml,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Telegram: drm3a_bot push notification
// ─────────────────────────────────────────────────────────────────────────────

const sendTelegramAlert = async (flag) => {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('Telegram credentials not set — skipping push notification.');
    return;
  }

  const emoji     = flag.flagState === 'ACT_NOW' ? '🚨' : '⚠️';
  const typeLabel = flag.flagType === 'academic' ? 'Academic' : 'Behavioral';
  const message   = [
    `${emoji} *DM3A At-Risk Alert*`,
    `👤 Student: ${flag.studentName}`,
    `📚 Course: ${flag.courseCode}`,
    `🔖 Rule: ${flag.triggerRule} (${typeLabel})`,
    `📋 ${flag.triggerDescription}`,
    `→ [Open Dashboard](${process.env.FRONTEND_URL}/dashboard)`,
  ].join('\n');

  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      chat_id:    CHAT_ID,
      text:       message,
      parse_mode: 'Markdown',
    }
  );
};

module.exports = { dispatchAlerts };
