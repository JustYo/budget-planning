import nodemailer from 'nodemailer';

import { getConfig } from './config.js';

export async function sendEmail({ subject, html }) {
  const cfg = getConfig();

  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: cfg.smtpUser
      ? { user: cfg.smtpUser, pass: cfg.smtpPassword }
      : undefined,
  });

  const info = await transporter.sendMail({
    from: cfg.fromEmail || cfg.notifyEmail,
    to: cfg.notifyEmail,
    subject,
    html,
  });
  console.log(`Email sent: ${info.messageId}`);
}
