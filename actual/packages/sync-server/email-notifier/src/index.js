import cron from 'node-cron';

import { fetchDailyData, fetchWeeklyData } from './actual.js';
import { getConfig } from './config.js';
import { sendEmail } from './emailer.js';
import { dailyTemplate, weeklyTemplate } from './templates.js';

// Actual Budget's api/bank-sync handler can fire a second async rejection after
// our try-catch has already returned (the underlying bank sync worker throws
// asynchronously). Without this handler Node.js would crash the process even
// though we already handled the first error. We only suppress errors that
// originate from the bundled API — everything else is re-thrown.
process.on('unhandledRejection', reason => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (
    msg.includes('bank-sync') ||
    msg.includes('There was an internal error') ||
    msg.includes('GoCardless') ||
    msg.includes('EnableBanking') ||
    msg.includes('SimpleFin') ||
    msg.includes('PluggyAI')
  ) {
    console.warn('Suppressed async bank-sync rejection:', msg);
    return;
  }
  // For anything unrelated, log and exit so real bugs are not silently swallowed.
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

async function runDaily() {
  const cfg = getConfig();
  if (!cfg.smtpHost || !cfg.notifyEmail || !cfg.budgetId) {
    console.log('Daily digest: skipped (not fully configured)');
    return;
  }
  console.log('Running daily digest...');
  try {
    const data = await fetchDailyData();
    const html = dailyTemplate(data);
    const today = new Date().toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
    });
    await sendEmail({ subject: `💰 Budget Digest · ${today}`, html });
    console.log('Daily digest sent.');
  } catch (err) {
    console.error('Daily digest failed:', err);
  }
}

async function runWeekly() {
  const cfg = getConfig();
  if (!cfg.smtpHost || !cfg.notifyEmail || !cfg.budgetId) {
    console.log('Weekly summary: skipped (not fully configured)');
    return;
  }
  console.log('Running weekly summary...');
  try {
    const data = await fetchWeeklyData();
    const html = weeklyTemplate(data);
    const month = new Date().toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });
    await sendEmail({ subject: `📊 Weekly Budget Summary · ${month}`, html });
    console.log('Weekly summary sent.');
  } catch (err) {
    console.error('Weekly summary failed:', err);
  }
}

// Parse a simple "M H * * [D]" cron expression into { minute, hour, day }
// day is undefined for daily schedules.
function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  return {
    minute: parseInt(parts[0]),
    hour: parseInt(parts[1]),
    day: parts[4] !== '*' ? parseInt(parts[4]) : undefined,
  };
}

// Return { hour, minute, weekday } for the current moment in the given timezone.
// weekday is 0 (Sun) … 6 (Sat), matching cron convention.
function localNow(timezone) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);

  const get = type => parts.find(p => p.type === type)?.value ?? '';
  const hourRaw = parseInt(get('hour'));
  const minute = parseInt(get('minute'));
  // Intl hour12:false can return '24' for midnight — normalise to 0
  const hour = hourRaw === 24 ? 0 : hourRaw;

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = WEEKDAYS.indexOf(get('weekday'));

  return { hour, minute, weekday };
}

// Run every minute. Re-reads config each tick so UI changes take effect
// immediately without needing a container restart.
cron.schedule('* * * * *', async () => {
  const cfg = getConfig();
  const { hour, minute, weekday } = localNow(cfg.timezone);

  const daily = cfg.notifications.dailyDigest;
  if (daily.enabled) {
    const s = parseCron(daily.cron);
    if (s.hour === hour && s.minute === minute) {
      await runDaily();
    }
  }

  const weekly = cfg.notifications.weeklySummary;
  if (weekly.enabled) {
    const s = parseCron(weekly.cron);
    if (s.hour === hour && s.minute === minute && s.day === weekday) {
      await runWeekly();
    }
  }
});

if (process.env.RUN_NOW === 'daily') void runDaily();
if (process.env.RUN_NOW === 'weekly') void runWeekly();

console.log('Email notifier running. Checking schedule every minute.');
