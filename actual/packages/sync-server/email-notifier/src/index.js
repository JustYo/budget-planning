import cron from 'node-cron';

import { fetchDailyData, fetchWeeklyData } from './actual.js';
import { getConfig } from './config.js';
import { sendEmail } from './emailer.js';
import { dailyTemplate, weeklyTemplate } from './templates.js';

async function runDaily() {
  const cfg = getConfig();
  const notif = cfg.notifications.dailyDigest;
  if (!notif.enabled || !cfg.smtpHost || !cfg.notifyEmail || !cfg.budgetId) {
    console.log('Daily digest: skipped (disabled or not fully configured)');
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
  const notif = cfg.notifications.weeklySummary;
  if (!notif.enabled || !cfg.smtpHost || !cfg.notifyEmail || !cfg.budgetId) {
    console.log('Weekly summary: skipped (disabled or not fully configured)');
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

// Read cron schedules from config at startup; restart container to change schedule
const cfg = getConfig();
const dailyCron = cfg.notifications.dailyDigest.cron;
const weeklyCron = cfg.notifications.weeklySummary.cron;
const timezone = cfg.timezone;

console.log(`Scheduling daily digest:   ${dailyCron} (${timezone})`);
console.log(`Scheduling weekly summary: ${weeklyCron} (${timezone})`);

cron.schedule(dailyCron, runDaily, { timezone });
cron.schedule(weeklyCron, runWeekly, { timezone });

if (process.env.RUN_NOW === 'daily') void runDaily();
if (process.env.RUN_NOW === 'weekly') void runWeekly();

console.log('Email notifier running. Waiting for scheduled jobs...');
