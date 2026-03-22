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

async function withBudget(fn) {
  const cfg = getConfig();
  await api.init({
    serverURL: cfg.serverUrl,
    password: cfg.password,
    dataDir: '/tmp/notifier-cache',
  });
  try {
    await api.downloadBudget(cfg.budgetId);
    return await fn();
  } finally {
    await api.shutdown();
  }
}

export async function fetchDailyData() {
  return withBudget(async () => {
    const month = currentMonth();
    const today = currentDay();
    const in7days = addDays(today, 7);

    const [monthData, schedules, payees] = await Promise.all([
      api.getBudgetMonth(month),
      api.getSchedules(),
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

    // Upcoming schedules (next 7 days) and overdue
    const upcoming = schedules
      .filter(s => !s.completed && s.next_date != null)
      .filter(s => s.next_date <= in7days)
      .sort((a, b) => a.next_date.localeCompare(b.next_date))
      .map(s => ({
        name: s.name || payeesById[s._payee]?.name || 'Unknown',
        next_date: s.next_date,
        amount: s._amount,
        amountOp: s._amountOp,
        overdue: s.next_date < today,
      }));

    let totalIncome = 0;
    let totalSpent = 0;
    for (const group of monthData.categoryGroups ?? []) {
      if (group.is_income) {
        totalIncome += group.received ?? 0;
      } else {
        totalSpent += group.spent ?? 0;
      }
    }

    return {
      month,
      today,
      overspent,
      upcoming,
      totalIncome,
      totalSpent,
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
    for (const g of monthData.categoryGroups ?? []) {
      if (g.is_income) totalIncome += g.received ?? 0;
    }
    for (const g of prevMonthData.categoryGroups ?? []) {
      if (g.is_income) prevIncome += g.received ?? 0;
    }

    const totalSpent = groups.reduce((sum, g) => sum + g.spent, 0);
    const prevSpent = (prevMonthData.categoryGroups ?? [])
      .filter(g => !g.is_income)
      .reduce((sum, g) => sum + (g.spent ?? 0), 0);

    const accountBalances = await Promise.all(
      accounts
        .filter(a => !a.closed && !a.offbudget)
        .map(async a => ({
          name: a.name,
          balance: await api.getAccountBalance(a.id),
        })),
    );

    return {
      month,
      prevMonth: prevMonthStr,
      toBudget: monthData.toBudget ?? null,
      totalIncome,
      prevIncome,
      totalSpent,
      prevSpent,
      groups,
      accountBalances,
    };
  });
}
