// @ts-strict-ignore
import React, { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Trans } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import {
  Area,
  AreaChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import * as monthUtils from '@actual-app/core/shared/months';
import type { SpendingEntity } from '@actual-app/core/types/models';

import { Container } from '#components/reports/Container';
import { createSpendingSpreadsheet } from '#components/reports/spreadsheets/spending-spreadsheet';
import { useReport } from '#components/reports/useReport';
import { useFormat } from '#hooks/useFormat';
import { useSyncedPref } from '#hooks/useSyncedPref';

type SpendingMiniChartProps = {
  month: string;
  style?: CSSProperties;
};

export function SpendingMiniChart({ month, style }: SpendingMiniChartProps) {
  const format = useFormat();
  const [budgetTypePref] = useSyncedPref('budgetType');
  const budgetType: 'envelope' | 'tracking' =
    budgetTypePref === 'tracking' ? 'tracking' : 'envelope';

  const prevMonth = monthUtils.prevMonth(month);

  const getSpendingData = useMemo(
    () =>
      createSpendingSpreadsheet({
        compare: month,
        compareTo: prevMonth,
        budgetType,
      }),
    [month, prevMonth, budgetType],
  );

  const data = useReport<SpendingEntity>(
    'budget-summary-spending',
    getSpendingData,
  );

  const totalBudget =
    data?.intervalData?.[27]?.budget != null
      ? data.intervalData[27].budget * -1
      : null;

  return (
    <View style={style}>
      <Container style={{ height: 180 }}>
        {(width, height) =>
          data?.intervalData ? (
            <AreaChart
              responsive
              width={width}
              height={height}
              data={data.intervalData}
              margin={{ top: 4, right: 8, left: 0, bottom: 8 }}
            >
              <defs>
                <linearGradient id="miniChartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={theme.reportsChartFill}
                    stopOpacity={0.25}
                  />
                  <stop
                    offset="95%"
                    stopColor={theme.reportsChartFill}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="day"
                interval={6}
                tick={{ fill: theme.pageTextLight, fontSize: 10 }}
                tickLine={{ stroke: theme.pageTextLight }}
                axisLine={{ stroke: theme.tableBorder }}
              />
              <YAxis
                tickFormatter={val => format(val, 'financial-no-decimals')}
                tick={{ fill: theme.pageTextLight, fontSize: 10 }}
                tickLine={{ stroke: theme.pageTextLight }}
                axisLine={{ stroke: theme.tableBorder }}
                width={36}
                tickSize={0}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  format(value, 'financial'),
                  name,
                ]}
                contentStyle={{
                  backgroundColor: theme.menuBackground,
                  border: `1px solid ${theme.tableBorder}`,
                  borderRadius: 4,
                  fontSize: 11,
                  color: theme.menuItemText,
                }}
                isAnimationActive={false}
              />
              {totalBudget != null && (
                <ReferenceLine
                  y={totalBudget}
                  stroke={theme.reportsRed}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
              )}
              <Area
                type="linear"
                dataKey={item =>
                  item.months[month]?.cumulative != null
                    ? item.months[month].cumulative * -1
                    : null
                }
                name="This month"
                stroke={theme.reportsChartFill}
                strokeWidth={2}
                fill="url(#miniChartFill)"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                type="linear"
                dataKey={item =>
                  item.months[prevMonth]?.cumulative != null
                    ? item.months[prevMonth].cumulative * -1
                    : null
                }
                name="Last month"
                stroke={theme.reportsGray}
                strokeDasharray="5 5"
                strokeWidth={1.5}
                fill="none"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : null
        }
      </Container>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 10,
          paddingTop: 2,
          paddingBottom: 6,
          fontSize: 10,
          color: theme.pageTextLight,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <div
            style={{
              width: 14,
              height: 2,
              backgroundColor: theme.reportsChartFill,
              borderRadius: 1,
            }}
          />
          <Trans>This month</Trans>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <div
            style={{
              width: 14,
              height: 2,
              background: `repeating-linear-gradient(to right, ${theme.reportsGray} 0, ${theme.reportsGray} 4px, transparent 4px, transparent 8px)`,
            }}
          />
          <Trans>Last month</Trans>
        </View>
        {totalBudget != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <div
              style={{
                width: 14,
                height: 2,
                background: `repeating-linear-gradient(to right, ${theme.reportsRed} 0, ${theme.reportsRed} 4px, transparent 4px, transparent 8px)`,
              }}
            />
            <Trans>Budget</Trans>
          </View>
        )}
      </View>
    </View>
  );
}
