// All amounts from Actual are stored as integer cents (e.g. 1234 = $12.34)
function fmt(amount) {
  if (amount == null) return '—';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount) / 100;
  return `${sign}€${abs.toFixed(2)}`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function progressBar(spent, budgeted) {
  if (!budgeted || budgeted <= 0) return '';
  const pct = Math.min(100, Math.round((Math.abs(spent) / budgeted) * 100));
  const color = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f97316' : '#22c55e';
  return `
    <div style="background:#e5e7eb;border-radius:4px;height:6px;width:100%;margin-top:3px;">
      <div style="background:${color};height:6px;border-radius:4px;width:${pct}%;"></div>
    </div>`;
}

// Budget panel matching the MonthlyBudgetPanel UI component.
// totalBudgeted: positive cents (sum of category budgets)
// totalSpent: negative cents (sum of category spending)
// syncedBalance: cents from bank-synced accounts only
function budgetPanel(totalBudgeted, totalSpent, syncedBalance) {
  const budget = totalBudgeted;
  const spent = Math.abs(totalSpent);
  const left = budget - spent;
  const isOver = left < 0;
  const pct =
    budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const barColor = isOver ? '#ef4444' : pct >= 80 ? '#f97316' : '#3b82f6';
  const leftColor = isOver ? '#ef4444' : '#22c55e';
  const balanceDiff = syncedBalance - budget;
  const hasBenefit = balanceDiff >= 0;

  const leftDisplay = isOver
    ? `<span style="font-size:11px;margin-right:4px;color:#ef4444;">Over</span>−${fmt(Math.abs(left))}`
    : fmt(left);

  return `
  <div style="background:white;border-radius:8px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <h2 style="margin:0 0 14px;font-size:15px;color:#1e3a5f;">📊 Monthly Budget</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
      <tr>
        <td style="font-size:12px;color:#9ca3af;padding:4px 0;">Budget</td>
        <td style="text-align:right;font-size:14px;font-weight:600;color:#374151;padding:4px 0;">${fmt(budget)}</td>
      </tr>
      <tr>
        <td style="font-size:12px;color:#9ca3af;padding:4px 0;">Spent</td>
        <td style="text-align:right;font-size:14px;font-weight:600;color:${isOver ? '#ef4444' : '#374151'};padding:4px 0;">${fmt(spent)}</td>
      </tr>
      <tr style="border-top:1px solid #e5e7eb;">
        <td style="font-size:11px;color:#9ca3af;padding:8px 0 4px;">
          ${fmt(budget)} − ${fmt(spent)} =
        </td>
        <td style="text-align:right;font-size:16px;font-weight:700;color:${leftColor};padding:8px 0 4px;">${leftDisplay}</td>
      </tr>
    </table>
    <div style="background:#e5e7eb;border-radius:4px;height:8px;width:100%;margin-bottom:4px;">
      <div style="background:${barColor};height:8px;border-radius:4px;width:${isOver ? 100 : pct}%;"></div>
    </div>
    <div style="font-size:11px;color:${isOver ? '#ef4444' : '#9ca3af'};margin-bottom:14px;">${pct}%${isOver ? ' — Over budget' : ''}</div>
    <div style="border-top:1px solid #e5e7eb;padding-top:12px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
        <tr>
          <td style="font-size:12px;color:#9ca3af;">Bank balance</td>
          <td style="text-align:right;font-size:14px;font-weight:600;color:#374151;">${fmt(syncedBalance)}</td>
        </tr>
      </table>
      <div style="border-radius:4px;padding:8px 12px;background:${hasBenefit ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'};display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;font-weight:600;color:${hasBenefit ? '#16a34a' : '#ef4444'};">${hasBenefit ? 'Benefit' : 'Over budget'}</span>
        <span style="font-size:15px;font-weight:700;color:${hasBenefit ? '#16a34a' : '#ef4444'};">${hasBenefit ? `+${fmt(balanceDiff)}` : `−${fmt(Math.abs(balanceDiff))}`}</span>
      </div>
    </div>
  </div>`;
}

const baseStyle = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f3f4f6;
  margin: 0; padding: 20px;
`;

const cardStyle = `
  background: white;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
`;

function header(title, subtitle) {
  return `
  <div style="background:#1e3a5f;color:white;border-radius:8px;padding:20px 24px;margin-bottom:16px;">
    <h1 style="margin:0;font-size:20px;font-weight:700;">${title}</h1>
    <p style="margin:6px 0 0;font-size:13px;opacity:0.8;">${subtitle}</p>
  </div>`;
}

function bankSyncWarning(error) {
  if (!error) return '';
  return `
  <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px 18px;margin-bottom:16px;">
    <p style="margin:0;font-size:13px;color:#92400e;">
      ⚠️ <strong>Bank sync failed</strong> — transactions may be out of date.<br>
      <span style="opacity:0.8;">Please re-link your bank account in Actual Budget (Accounts → your account → Sync).</span>
    </p>
  </div>`;
}

export function dailyTemplate({
  today,
  month,
  overspent,
  upcoming,
  totalSpent,
  totalBudgeted,
  syncedBalance,
  bankSyncError,
}) {
  const overspentHtml =
    overspent.length === 0
      ? `<p style="color:#6b7280;margin:0;">✅ No overspent categories</p>`
      : overspent
          .map(
            c => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:13px;color:#374151;">${c.group} › <strong>${c.name}</strong></div>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">
          <span style="color:#ef4444;font-weight:600;">${fmt(c.balance)}</span>
          <div style="font-size:11px;color:#9ca3af;">budgeted ${fmt(c.budgeted)}</div>
        </td>
      </tr>`,
          )
          .join('');

  const upcomingHtml =
    upcoming.length === 0
      ? `<p style="color:#6b7280;margin:0;">📭 No upcoming schedules in the next 7 days</p>`
      : upcoming
          .map(
            s => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:13px;color:#374151;font-weight:500;">${s.name}</div>
          <div style="font-size:11px;color:${s.overdue ? '#ef4444' : '#6b7280'};">
            ${s.overdue ? '⚠️ Overdue · ' : ''}${fmtDate(s.next_date)}
          </div>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;">
          <span style="font-weight:600;color:${s.amount < 0 ? '#ef4444' : '#22c55e'};">
            ${fmt(s.amount)}
          </span>
        </td>
      </tr>`,
          )
          .join('');

  return `<!DOCTYPE html>
<html><body style="${baseStyle}">
  ${header('Daily Budget Digest', fmtDate(today))}
  ${bankSyncWarning(bankSyncError)}

  ${budgetPanel(totalBudgeted, totalSpent, syncedBalance)}

  <div style="${cardStyle}">
    <h2 style="margin:0 0 14px;font-size:15px;color:#1e3a5f;">⚠️ Overspent Categories</h2>
    <table style="width:100%;border-collapse:collapse;">${overspentHtml}</table>
  </div>

  <div style="${cardStyle}">
    <h2 style="margin:0 0 14px;font-size:15px;color:#1e3a5f;">📅 Upcoming Scheduled Transactions</h2>
    <table style="width:100%;border-collapse:collapse;">${upcomingHtml}</table>
  </div>

  <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:8px;">
    Actual Budget · ${month}
  </p>
</body></html>`;
}

export function weeklyTemplate({
  month,
  totalIncome,
  prevIncome,
  totalSpent,
  prevSpent,
  totalBudgeted,
  syncedBalance,
  groups,
  accountBalances,
  bankSyncError,
}) {
  const net = totalIncome + totalSpent;
  const prevNet = prevIncome + prevSpent;

  function trend(current, previous) {
    if (!previous) return '';
    const diff = current - previous;
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
    const color = diff > 0 ? '#22c55e' : diff < 0 ? '#ef4444' : '#6b7280';
    return `<span style="color:${color};font-size:11px;margin-left:4px;">${arrow} ${fmt(Math.abs(diff))}</span>`;
  }

  const groupsHtml = groups
    .map(
      g => `
    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
        <span style="font-weight:600;color:#374151;font-size:14px;">${g.name}</span>
        <span style="font-size:13px;color:#6b7280;">${fmt(g.spent)} / ${fmt(g.budgeted)}</span>
      </div>
      ${progressBar(g.spent, g.budgeted)}
      ${g.categories
        .slice(0, 5)
        .map(
          c => `
        <div style="display:flex;justify-content:space-between;padding:4px 0 0 12px;font-size:12px;color:#6b7280;">
          <span>${c.name}</span>
          <span style="color:${c.balance < 0 ? '#ef4444' : '#374151'};">${fmt(c.spent)}</span>
        </div>`,
        )
        .join('')}
    </div>`,
    )
    .join('');

  const accountsHtml = accountBalances
    .map(
      a => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${a.name}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;
          color:${a.balance < 0 ? '#ef4444' : '#374151'};">${fmt(a.balance)}</td>
    </tr>`,
    )
    .join('');

  const formattedMonth = new Date(month + '-01').toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return `<!DOCTYPE html>
<html><body style="${baseStyle}">
  ${header('Weekly Budget Summary', formattedMonth)}
  ${bankSyncWarning(bankSyncError)}

  ${budgetPanel(totalBudgeted, totalSpent, syncedBalance)}

  <div style="${cardStyle}">
    <h2 style="margin:0 0 14px;font-size:15px;color:#1e3a5f;">💰 Income</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:10px 16px;text-align:center;border-right:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">This month</div>
          <div style="font-size:18px;font-weight:700;color:#22c55e;">${fmt(totalIncome)}</div>
        </td>
        <td style="padding:10px 16px;text-align:center;border-right:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Last month</div>
          <div style="font-size:18px;font-weight:700;color:#6b7280;">${fmt(prevIncome)}</div>
        </td>
        <td style="padding:10px 16px;text-align:center;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Net savings</div>
          <div style="font-size:18px;font-weight:700;color:${net >= 0 ? '#22c55e' : '#ef4444'};">${fmt(net)}</div>
          ${trend(net, prevNet)}
        </td>
      </tr>
    </table>
  </div>

  <div style="${cardStyle}">
    <h2 style="margin:0 0 16px;font-size:15px;color:#1e3a5f;">💸 Spending by Category</h2>
    ${groupsHtml || '<p style="color:#6b7280;margin:0;">No spending recorded yet this month</p>'}
  </div>

  <div style="${cardStyle}">
    <h2 style="margin:0 0 14px;font-size:15px;color:#1e3a5f;">🏦 Account Balances</h2>
    <table style="width:100%;border-collapse:collapse;">
      ${accountsHtml}
      <tr>
        <td style="padding:10px 0;font-weight:700;font-size:13px;">Total</td>
        <td style="padding:10px 0;text-align:right;font-weight:700;font-size:14px;
            color:${accountBalances.reduce((s, a) => s + a.balance, 0) < 0 ? '#ef4444' : '#1e3a5f'};">
          ${fmt(accountBalances.reduce((s, a) => s + a.balance, 0))}
        </td>
      </tr>
    </table>
  </div>

  <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:8px;">
    Actual Budget · Weekly Summary
  </p>
</body></html>`;
}
