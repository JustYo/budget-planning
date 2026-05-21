import { existsSync, readFileSync } from 'node:fs';

const CONFIG_PATH =
  process.env.EMAIL_CONFIG_PATH ?? '/data/server-files/email-config.json';

// Load settings from the JSON file written by the sync-server settings page.
// Environment variables are only used for server URL, password, and budget ID
// since those can't be configured from the UI (they're infrastructure settings).
function load() {
  let file = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      console.warn('email-notifier: could not parse', CONFIG_PATH);
    }
  }

  return {
    // Infrastructure — env vars only (not exposed via UI)
    serverUrl: process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006',
    password: process.env.ACTUAL_PASSWORD ?? '',
    budgetId: process.env.ACTUAL_BUDGET_ID ?? '',
    ebImporterUrl: process.env.EB_IMPORTER_URL ?? '',

    // SMTP & recipient — set from UI, written to JSON file
    smtpHost: file.smtpHost ?? '',
    smtpPort: file.smtpPort ?? 587,
    smtpSecure: file.smtpSecure ?? false,
    smtpUser: file.smtpUser ?? '',
    smtpPassword: file.smtpPassword ?? '',
    fromEmail: file.fromEmail ?? '',
    notifyEmail: file.notifyEmail ?? '',
    timezone: file.timezone ?? 'Europe/Paris',

    // Per-notification settings — set from UI
    notifications: {
      dailyDigest: {
        enabled: file.notifications?.dailyDigest?.enabled ?? false,
        cron: file.notifications?.dailyDigest?.cron ?? '0 8 * * *',
      },
      weeklySummary: {
        enabled: file.notifications?.weeklySummary?.enabled ?? false,
        cron: file.notifications?.weeklySummary?.cron ?? '0 9 * * 0',
      },
    },
  };
}

// Re-read on every call so cron jobs pick up settings changes without restart
export function getConfig() {
  return load();
}
