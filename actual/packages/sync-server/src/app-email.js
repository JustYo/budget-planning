import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import express from 'express';
import nodemailer from 'nodemailer';

import { loginWithPassword } from './accounts/password';
import { config } from './load-config';
import { requestLoggerMiddleware } from './util/middlewares';

const app = express();
export { app as handlers };
app.use(express.json());
app.use(requestLoggerMiddleware);

// POST /email-settings/internal-token
// Used by the email notifier to get a session token without going through
// OpenID browser flow. Protected by the ACTUAL_PASSWORD env var.
app.post('/internal-token', (req, res) => {
  const { secret } = req.body ?? {};
  const serverPassword = process.env.ACTUAL_PASSWORD ?? '';
  if (!serverPassword || secret !== serverPassword) {
    return res.status(401).json({ status: 'error', reason: 'unauthorized' });
  }
  const { error, token } = loginWithPassword(serverPassword);
  if (error) {
    return res.status(400).json({ status: 'error', reason: error });
  }
  res.json({ token });
});

function getConfigPath() {
  return join(config.get('serverFiles'), 'email-config.json');
}

function readEmailConfig() {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function writeEmailConfig(cfg) {
  writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

const DEFAULT_NOTIFICATIONS = {
  dailyDigest: { enabled: false, cron: '0 8 * * *' },
  weeklySummary: { enabled: false, cron: '0 9 * * 0' },
};

// GET /email-settings — return current settings (password is never sent back)
app.get('/', (req, res) => {
  const cfg = readEmailConfig();
  const notifications = {
    dailyDigest: {
      enabled:
        cfg.notifications?.dailyDigest?.enabled ??
        DEFAULT_NOTIFICATIONS.dailyDigest.enabled,
      cron:
        cfg.notifications?.dailyDigest?.cron ??
        DEFAULT_NOTIFICATIONS.dailyDigest.cron,
    },
    weeklySummary: {
      enabled:
        cfg.notifications?.weeklySummary?.enabled ??
        DEFAULT_NOTIFICATIONS.weeklySummary.enabled,
      cron:
        cfg.notifications?.weeklySummary?.cron ??
        DEFAULT_NOTIFICATIONS.weeklySummary.cron,
    },
  };
  res.json({
    notifyEmail: cfg.notifyEmail ?? '',
    fromEmail: cfg.fromEmail ?? '',
    smtpHost: cfg.smtpHost ?? '',
    smtpPort: cfg.smtpPort ?? 587,
    smtpSecure: cfg.smtpSecure ?? false,
    smtpUser: cfg.smtpUser ?? '',
    smtpPasswordSet: !!cfg.smtpPassword,
    timezone: cfg.timezone ?? 'Europe/Paris',
    notifications,
  });
});

// POST /email-settings — save settings
app.post('/', (req, res) => {
  const existing = readEmailConfig();
  const {
    notifyEmail,
    fromEmail,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPassword,
    timezone,
    notifications,
  } = req.body ?? {};

  const updated = {
    ...existing,
    notifyEmail: notifyEmail ?? existing.notifyEmail ?? '',
    fromEmail: fromEmail ?? existing.fromEmail ?? '',
    smtpHost: smtpHost ?? existing.smtpHost ?? '',
    smtpPort: smtpPort ?? existing.smtpPort ?? 587,
    smtpSecure: smtpSecure ?? existing.smtpSecure ?? false,
    smtpUser: smtpUser ?? existing.smtpUser ?? '',
    timezone: timezone ?? existing.timezone ?? 'Europe/Paris',
    notifications: {
      dailyDigest: {
        enabled:
          notifications?.dailyDigest?.enabled ??
          existing.notifications?.dailyDigest?.enabled ??
          false,
        cron:
          notifications?.dailyDigest?.cron ??
          existing.notifications?.dailyDigest?.cron ??
          '0 8 * * *',
      },
      weeklySummary: {
        enabled:
          notifications?.weeklySummary?.enabled ??
          existing.notifications?.weeklySummary?.enabled ??
          false,
        cron:
          notifications?.weeklySummary?.cron ??
          existing.notifications?.weeklySummary?.cron ??
          '0 9 * * 0',
      },
    },
  };

  // Only update password if a new one was provided
  if (smtpPassword) {
    updated.smtpPassword = smtpPassword;
  }

  writeEmailConfig(updated);
  res.json({ status: 'ok' });
});

// POST /email-settings/test — send a test email using current settings
app.post('/test', async (req, res) => {
  const cfg = readEmailConfig();

  if (!cfg.smtpHost || !cfg.notifyEmail) {
    return res.status(400).json({
      status: 'error',
      reason: 'SMTP host and recipient email are required',
    });
  }

  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort ?? 587,
    secure: cfg.smtpSecure ?? false,
    auth: cfg.smtpUser
      ? { user: cfg.smtpUser, pass: cfg.smtpPassword ?? '' }
      : undefined,
  });

  try {
    await transporter.sendMail({
      from: cfg.fromEmail || cfg.notifyEmail,
      to: cfg.notifyEmail,
      subject: '✅ Actual Budget — SMTP connection test',
      html: `
        <div style="font-family:sans-serif;padding:20px;max-width:480px;">
          <h2 style="color:#1e3a5f;">Connection test successful!</h2>
          <p>Your SMTP settings are working correctly.</p>
          <p>You can now enable the notifications you want to receive.</p>
        </div>
      `,
    });
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', reason: err.message });
  }
});
