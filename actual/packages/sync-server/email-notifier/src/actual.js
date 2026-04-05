import { mkdirSync } from 'node:fs';

import * as api from '@actual-app/api';

import { getConfig } from './config.js';

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function currentDay() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Actual Budget stores next_date as YYYYMMDD integer; normalise to YYYY-MM-DD.
function toIsoDate(nextDate) {
  if (!nextDate) return null;
  const s = String(nextDate);
  return s.includes('-')
    ? s
    : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const DATA_DIR = '/tmp/notifier-cache';

async function getToken(serverUrl, password) {
  try {
    const res = await fetch(`${serverUrl}/email-settings/internal-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: password }),
    });
    if (res.ok) {
      const { token } = await res.json();
      return token ?? null;
    }
  } catch {
    // fall through
  }
  return null;
}

async function withBudget(fn) {
  const cfg = getConfig();
  mkdirSync(DATA_DIR, { recursive: true });
  const sessionToken = await getToken(cfg.serverUrl, cfg.password);
  await api.init({
    serverURL: cfg.serverUrl,
    ...(sessionToken ? { sessionToken } : { password: cfg.password }),
    dataDir: DATA_DIR,
  });
  try {
    await api.downloadBudget(cfg.budgetId);
    // The @actual-app/api bundle clears user-token from asyncStorage when
    // open-budget runs and server-url isn't stored there. Re-set it so that
    // bank sync (which reads user-token to authenticate) works correctly.
    if (sessionToken && api.internal) {
      await api.internal.send('subscribe-set-token', { token: sessionToken });
    }
    // Read schedules BEFORE bank sync — after sync, matched transactions
    // auto-complete the schedule and it disappears from the pending list.
    const preSyncSchedules = await api.getSchedules();
    let bankSyncError = null;
    try {
      await api.runBankSync();
    } catch (err) {
      console.warn('Bank sync failed:', err.message);
      bankSyncError = err.message;
    }
    const data = await fn({ preSyncSchedules });
    return { ...data, bankSyncError };
  } finally {
    try {
      await api.shutdown();
    } catch {
      // ignore shutdown errors so email still sends
    }
  }
}

export async function fetchDailyData() {
  return withBudget(async ({ preSyncSchedules }) => {
    const month = currentMonth();
    const today = currentDay();
    const in7days = addDays(today, 7);

    const [monthData, payees] = await Promise.all([
      api.getBudgetMonth(month),
      api.getPayees(),
    ]);

    const payeesById = Object.fromEntries(payees.map(p => [p.id, p]));

    // Overspent categories (balance < 0, excluding income groups)
    const overspent = [];
    for (const group of monthData.categoryGroups ?? []) {
      if (group.is_income) continue;
      for (const cat of group.categories ?? []) {
        if (cat.balance < 0) {
          overspent.push({
            group: group.name,
            name: cat.name,
            balance: cat.balance,
            budgeted: cat.budgeted,
            spent: cat.spent,
          });
        }
      }
    }
    overspent.sort((a, b) => a.balance - b.balance);

    // Upcoming schedules (next 7 days) and overdue — uses pre-sync snapshot
    // so schedules auto-matched during bank sync still appear as pending.
    // next_date is stored as YYYYMMDD integer; normalise to YYYY-MM-DD for comparison.
    const upcoming = preSyncSchedules
      .filter(s => !s.completed && s.next_date != null)
      .map(s => ({ ...s, _isoDate: toIsoDate(s.next_date) }))
      .filter(s => s._isoDate <= in7days)
      .sort((a, b) => a._isoDate.localeCompare(b._isoDate))
      .map(s => ({
        name: s.name || payeesById[s.payee]?.name || 'Unknown',
        next_date: s._isoDate,
        amount: s.amount,
        amountOp: s.amountOp,
        overdue: s._isoDate < today,
      }));

    let totalIncome = 0;
    let totalSpent = 0;
    let totalBudgeted = 0;
    for (const group of monthData.categoryGroups ?? []) {
      if (group.is_income) {
        totalIncome += group.received ?? 0;
      } else {
        totalSpent += group.spent ?? 0;
        totalBudgeted += group.budgeted ?? 0;
      }
    }

    // Synced account balance (bank-synced accounts only, matching the budget panel).
    // api.getAccounts() strips account_sync_source from the response, so we query
    // the accounts table directly to find which accounts have a sync source.
    const syncedAccountRows = await api.runQuery(
      api
        .q('accounts')
        .filter({
          account_sync_source: { $ne: null },
          offbudget: false,
          closed: false,
        })
        .select('id'),
    );
    const syncedIds = new Set((syncedAccountRows.data ?? []).map(r => r.id));
    const syncedBalanceValues = await Promise.all(
      [...syncedIds].map(id => api.getAccountBalance(id)),
    );
    const syncedBalance = syncedBalanceValues.reduce(
      (sum, b) => sum + (b ?? 0),
      0,
    );

    return {
      month,
      today,
      overspent,
      upcoming,
      totalIncome,
      totalSpent,
      totalBudgeted,
      syncedBalance,
      toBudget: monthData.toBudget ?? null,
    };
  });
}

export async function fetchWeeklyData() {
  return withBudget(async () => {
    const month = currentMonth();
    const prevMonth = new Date(month + '-01');
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const prevMonthStr = prevMonth.toISOString().slice(0, 7);

    const [monthData, prevMonthData, accounts] = await Promise.all([
      api.getBudgetMonth(month),
      api.getBudgetMonth(prevMonthStr),
      api.getAccounts(),
    ]);

    const groups = (monthData.categoryGroups ?? [])
      .filter(g => !g.is_income && !g.hidden)
      .map(g => ({
        name: g.name,
        budgeted: g.budgeted ?? 0,
        spent: g.spent ?? 0,
        balance: g.balance ?? 0,
        categories: (g.categories ?? [])
          .filter(c => !c.hidden && c.spent !== 0)
          .map(c => ({
            name: c.name,
            budgeted: c.budgeted,
            spent: c.spent,
            balance: c.balance,
          }))
          .sort((a, b) => a.spent - b.spent),
      }))
      .filter(g => g.spent !== 0);

    let totalIncome = 0;
    let prevIncome = 0;
    let totalBudgeted = 0;
    for (const g of monthData.categoryGroups ?? []) {
      if (g.is_income) {
        totalIncome += g.received ?? 0;
      } else {
        totalBudgeted += g.budgeted ?? 0;
      }
    }
    for (const g of prevMonthData.categoryGroups ?? []) {
      if (g.is_income) prevIncome += g.received ?? 0;
    }

    // Use full monthData for totalSpent to match the budget panel (not filtered groups)
    const totalSpent = (monthData.categoryGroups ?? [])
      .filter(g => !g.is_income)
      .reduce((sum, g) => sum + (g.spent ?? 0), 0);
    const prevSpent = (prevMonthData.categoryGroups ?? [])
      .filter(g => !g.is_income)
      .reduce((sum, g) => sum + (g.spent ?? 0), 0);

    // Fetch all on-budget account balances for display
    const accountBalances = await Promise.all(
      accounts
        .filter(a => !a.closed && !a.offbudget)
        .map(async a => ({
          name: a.name,
          balance: await api.getAccountBalance(a.id),
        })),
    );

    // Synced account balance (bank-synced only) — query directly since
    // api.getAccounts() strips account_sync_source from its response.
    const syncedAccountRows = await api.runQuery(
      api
        .q('accounts')
        .filter({
          account_sync_source: { $ne: null },
          offbudget: false,
          closed: false,
        })
        .select('id'),
    );
    const syncedIds = new Set((syncedAccountRows.data ?? []).map(r => r.id));
    const syncedBalanceValues = await Promise.all(
      [...syncedIds].map(id => api.getAccountBalance(id)),
    );
    const syncedBalance = syncedBalanceValues.reduce(
      (sum, b) => sum + (b ?? 0),
      0,
    );

    return {
      month,
      prevMonth: prevMonthStr,
      toBudget: monthData.toBudget ?? null,
      totalIncome,
      prevIncome,
      totalSpent,
      prevSpent,
      totalBudgeted,
      syncedBalance,
      groups,
      accountBalances,
    };
  });
}
