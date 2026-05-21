// @ts-strict-ignore
import React, { useState } from 'react';
import type { CSSProperties } from 'react';
import { Trans } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useEnvelopeSheetValue } from '#components/budget/envelope/EnvelopeBudgetComponents';
import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';
import { useSheetValue } from '#hooks/useSheetValue';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { envelopeBudget, syncedAccountBalance } from '#spreadsheet/bindings';

type MonthlyBudgetPanelProps = {
  month: string;
  style?: CSSProperties;
  isCollapsed?: boolean;
};

export function MonthlyBudgetPanel({
  style,
  isCollapsed = false,
}: MonthlyBudgetPanelProps) {
  const format = useFormat();

  const rawBudgeted = useEnvelopeSheetValue({
    name: envelopeBudget.totalBudgeted,
    value: 0,
  });
  const rawSpent = useEnvelopeSheetValue({
    name: envelopeBudget.totalSpent,
    value: 0,
  });
  const bankBalance =
    useSheetValue<'account', 'synced-accounts-balance'>(
      syncedAccountBalance(),
    ) ?? 0;

  const budget = -((rawBudgeted as number) ?? 0);
  const spent = -((rawSpent as number) ?? 0);
  const left = budget - spent;
  const isOver = left < 0;

  const balanceDiff = bankBalance - budget;
  const hasBenefit = balanceDiff >= 0;
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;

  const [thresholdPref, setThresholdPref] = useSyncedPref(
    'monthlyBudgetThreshold',
  );
  const thresholdAmount =
    thresholdPref && thresholdPref !== '' ? parseInt(thresholdPref, 10) : null;
  const isAboveThreshold = thresholdAmount != null && spent >= thresholdAmount;
  const isAlert = isOver || isAboveThreshold;

  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdInput, setThresholdInput] = useState('');

  const alertColor = theme.errorText;
  const normalColor = theme.pageText;
  const dimColor = theme.pageTextLight;
  const positiveColor = theme.toBudgetPositive;

  function saveThreshold() {
    const parsed = parseInt(thresholdInput, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setThresholdPref(String(parsed));
    } else if (thresholdInput === '') {
      setThresholdPref('');
    }
    setEditingThreshold(false);
  }

  if (isCollapsed) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          ...style,
        }}
      >
        <PrivacyFilter>
          <span
            style={{
              color: isAlert ? alertColor : normalColor,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <FinancialText>{format(spent, 'financial')}</FinancialText>
          </span>
        </PrivacyFilter>
        <span style={{ color: dimColor, fontSize: 11 }}>/</span>
        <PrivacyFilter>
          <span style={{ color: dimColor, fontSize: 11 }}>
            <FinancialText>{format(budget, 'financial')}</FinancialText>
          </span>
        </PrivacyFilter>
        <span style={{ color: isAlert ? alertColor : dimColor, fontSize: 11 }}>
          ({Math.round(pct)}%)
        </span>
      </View>
    );
  }

  return (
    <View
      style={{
        padding: '12px 16px',
        gap: 6,
        ...style,
      }}
    >
      {/* Budget row */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span style={{ fontSize: 12, color: dimColor }}>
          <Trans>Budget</Trans>
        </span>
        <PrivacyFilter>
          <span style={{ fontSize: 14, fontWeight: 600, color: normalColor }}>
            <FinancialText>{format(budget, 'financial')}</FinancialText>
          </span>
        </PrivacyFilter>
      </View>

      {/* Spent row */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span style={{ fontSize: 12, color: dimColor }}>
          <Trans>Spent</Trans>
        </span>
        <PrivacyFilter>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: isAlert ? alertColor : normalColor,
            }}
          >
            <FinancialText>{format(spent, 'financial')}</FinancialText>
          </span>
        </PrivacyFilter>
      </View>

      {/* Left / Over row — shown as Budget − Spent = X */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          borderTopWidth: 1,
          borderColor: theme.tableBorder,
          paddingTop: 6,
          marginTop: 2,
        }}
      >
        <PrivacyFilter
          style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}
        >
          <span style={{ fontSize: 11, color: dimColor }}>
            <FinancialText>{format(budget, 'financial')}</FinancialText>
          </span>
          <span style={{ fontSize: 11, color: dimColor }}>−</span>
          <span
            style={{ fontSize: 11, color: isAlert ? alertColor : dimColor }}
          >
            <FinancialText>{format(spent, 'financial')}</FinancialText>
          </span>
          <span style={{ fontSize: 11, color: dimColor }}>=</span>
        </PrivacyFilter>
        <PrivacyFilter>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: isOver
                ? alertColor
                : isAboveThreshold
                  ? alertColor
                  : positiveColor,
            }}
          >
            <FinancialText>
              {isOver
                ? `−${format(Math.abs(left), 'financial')}`
                : format(left, 'financial')}
            </FinancialText>
          </span>
        </PrivacyFilter>
      </View>

      {/* Progress bar */}
      <View style={{ marginTop: 4 }}>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.tableBorder,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${isOver ? 100 : pct}%`,
              borderRadius: 3,
              backgroundColor: isAlert ? alertColor : theme.reportsChartFill,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: 3,
          }}
        >
          <span
            style={{ fontSize: 10, color: isAlert ? alertColor : dimColor }}
          >
            {Math.round(pct)}%
          </span>
          {isOver && (
            <span style={{ fontSize: 10, color: alertColor }}>
              <Trans>Over by</Trans>{' '}
              <FinancialText>
                {format(Math.abs(left), 'financial')}
              </FinancialText>
            </span>
          )}
        </View>
      </View>

      {/* Bank balance vs budget section */}
      <View
        style={{
          borderTopWidth: 1,
          borderColor: theme.tableBorder,
          paddingTop: 10,
          marginTop: 6,
          gap: 6,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <span style={{ fontSize: 12, color: dimColor }}>
            <Trans>Bank balance</Trans>
          </span>
          <PrivacyFilter>
            <span style={{ fontSize: 14, fontWeight: 600, color: normalColor }}>
              <FinancialText>{format(bankBalance, 'financial')}</FinancialText>
            </span>
          </PrivacyFilter>
        </View>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderRadius: 4,
            padding: '6px 8px',
            backgroundColor: hasBenefit
              ? `${theme.reportsChartFill}22`
              : `${theme.errorText}22`,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: hasBenefit ? positiveColor : alertColor,
            }}
          >
            {hasBenefit ? <Trans>Benefit</Trans> : <Trans>Over budget</Trans>}
          </span>
          <PrivacyFilter>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: hasBenefit ? positiveColor : alertColor,
              }}
            >
              <FinancialText>
                {hasBenefit
                  ? `+${format(balanceDiff, 'financial')}`
                  : `−${format(Math.abs(balanceDiff), 'financial')}`}
              </FinancialText>
            </span>
          </PrivacyFilter>
        </View>
      </View>

      {/* Threshold editor */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginTop: 4,
          gap: 4,
        }}
      >
        {editingThreshold ? (
          <>
            <span style={{ fontSize: 11, color: dimColor }}>
              <Trans>Threshold:</Trans>
            </span>
            <input
              type="number"
              value={thresholdInput}
              onChange={e => setThresholdInput(e.target.value)}
              onBlur={saveThreshold}
              onKeyDown={e => {
                if (e.key === 'Enter') saveThreshold();
                if (e.key === 'Escape') setEditingThreshold(false);
              }}
              style={{
                width: 70,
                fontSize: 11,
                padding: '1px 4px',
                border: `1px solid ${theme.tableBorder}`,
                borderRadius: 3,
                backgroundColor: theme.tableBackground,
                color: theme.pageText,
              }}
            />
          </>
        ) : (
          <button
            onClick={() => {
              setThresholdInput(
                thresholdAmount != null ? String(thresholdAmount) : '',
              );
              setEditingThreshold(true);
            }}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 11,
              color: isAboveThreshold ? alertColor : dimColor,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            {thresholdAmount != null ? (
              <>
                <Trans>Threshold:</Trans>{' '}
                <FinancialText>
                  {format(thresholdAmount, 'financial-no-decimals')}
                </FinancialText>
                {' ✎'}
              </>
            ) : (
              <Trans>Set threshold…</Trans>
            )}
          </button>
        )}
      </View>
    </View>
  );
}
