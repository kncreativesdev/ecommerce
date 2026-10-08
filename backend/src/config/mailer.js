const nodemailer = require("nodemailer");

const { AppError } = require("../utils/appError");
const { env } = require("./env");

// Test-mode capture: tests import getTestOutbox() to read the generated
// OTP email without an inbox. The store lives on globalThis (not module
// state) so it is shared even when the test runner loads this module
// through a different resolution path than the service graph.
function getOutboxStore() {
  if (!Array.isArray(globalThis.__TECH_PULSE_TEST_OUTBOX__)) {
    globalThis.__TECH_PULSE_TEST_OUTBOX__ = [];
  }
  return globalThis.__TECH_PULSE_TEST_OUTBOX__;
}

let transporter = null;

function isTestMode() {
  return env.nodeEnv === "test";
}

function isSmtpConfigured() {
  return typeof env.mailSmtpHost === "string" && env.mailSmtpHost !== "";
}

function getTransporter() {
  if (!transporter) {
    const auth =
      env.mailSmtpUser !== "" || env.mailSmtpPass !== ""
        ? { user: env.mailSmtpUser, pass: env.mailSmtpPass }
        : undefined;
    transporter = nodemailer.createTransport({
      host: env.mailSmtpHost,
      port: env.mailSmtpPort,
      secure: env.mailSmtpPort === 465,
      auth,
    });
  }
  return transporter;
}

/**
 * Sends the password OTP email. The message carries only the code and
 * its expiry — never passwords, tokens, company ids, or database ids.
 * In test mode the message is captured in-memory instead of delivered.
 * When no SMTP host is configured outside tests, fails with 503
 * (same convention as unconfigured Google sign-in) rather than
 * silently dropping the code.
 */
async function sendOtpEmail({ to, otp, expiresMinutes }) {
  const subject = "Your Tech Pulse password reset code";
  const text = [
    `Your Tech Pulse verification code is: ${otp}`,
    ``,
    `This code expires in ${expiresMinutes} minutes and can be used once.`,
    `If you did not request a password change, you can safely ignore this email.`,
  ].join("\n");
  if (isTestMode()) {
    getOutboxStore().push({ to, subject, text });
    return { delivered: false, captured: true };
  }
  if (!isSmtpConfigured()) {
    throw new AppError(503, "EMAIL_NOT_CONFIGURED", "Email delivery is not configured");
  }
  await getTransporter().sendMail({ from: env.mailFrom, to, subject, text });
  return { delivered: true };
}

function getTestOutbox() {
  return getOutboxStore();
}

function clearTestOutbox() {
  getOutboxStore().length = 0;
}

module.exports = { sendOtpEmail, getTestOutbox, clearTestOutbox };
