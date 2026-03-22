import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import * as asyncStorage from 'loot-core/platform/server/asyncStorage';

import { Setting } from './UI';

import {
  Checkbox,
  FormField,
  FormLabel,
} from '@desktop-client/components/forms';
import { useServerURL } from '@desktop-client/components/ServerContext';
import { useSyncServerStatus } from '@desktop-client/hooks/useSyncServerStatus';

type NotificationConfig = {
  enabled: boolean;
  cron: string;
};

type EmailConfig = {
  notifyEmail: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPasswordSet: boolean;
  timezone: string;
  notifications: {
    dailyDigest: NotificationConfig;
    weeklySummary: NotificationConfig;
  };
};

const DAYS_OF_WEEK = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// cron "M H * * *" ↔ { hour, minute }
function parseDailyCron(cron: string): { hour: number; minute: number } {
  const [m, h] = cron.split(' ');
  return { hour: parseInt(h) || 8, minute: parseInt(m) || 0 };
}
function buildDailyCron(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`;
}

// cron "M H * * D" ↔ { hour, minute, day }
function parseWeeklyCron(cron: string): {
  hour: number;
  minute: number;
  day: number;
} {
  const parts = cron.split(' ');
  return {
    hour: parseInt(parts[1]) || 9,
    minute: parseInt(parts[0]) || 0,
    day: parseInt(parts[4]) || 0,
  };
}
function buildWeeklyCron(day: number, hour: number, minute: number): string {
  return `${minute} ${hour} * * ${day}`;
}

function toTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const nativeInputStyle: CSSProperties = {
  fontSize: 13,
  padding: '3px 8px',
  borderRadius: 4,
  border: `1px solid ${theme.tableBorder}`,
  backgroundColor: theme.tableBackground,
  color: theme.tableText,
  outline: 'none',
  height: 28,
};

function DailyScheduleInput({
  cron,
  onChange,
}: {
  cron: string;
  onChange: (cron: string) => void;
}) {
  const { hour, minute } = parseDailyCron(cron);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>
        <Trans>Every day at</Trans>
      </Text>
      <input
        type="time"
        value={toTimeValue(hour, minute)}
        onChange={e => {
          const [h, m] = e.target.value.split(':').map(Number);
          if (!isNaN(h) && !isNaN(m)) onChange(buildDailyCron(h, m));
        }}
        style={nativeInputStyle}
      />
    </View>
  );
}

function WeeklyScheduleInput({
  cron,
  onChange,
}: {
  cron: string;
  onChange: (cron: string) => void;
}) {
  const { hour, minute, day } = parseWeeklyCron(cron);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>
        <Trans>Every</Trans>
      </Text>
      <select
        value={day}
        onChange={e =>
          onChange(buildWeeklyCron(Number(e.target.value), hour, minute))
        }
        style={nativeInputStyle}
      >
        {DAYS_OF_WEEK.map((d, i) => (
          <option key={d} value={i}>
            {d}
          </option>
        ))}
      </select>
      <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>
        <Trans>at</Trans>
      </Text>
      <input
        type="time"
        value={toTimeValue(hour, minute)}
        onChange={e => {
          const [h, m] = e.target.value.split(':').map(Number);
          if (!isNaN(h) && !isNaN(m)) onChange(buildWeeklyCron(day, h, m));
        }}
        style={nativeInputStyle}
      />
    </View>
  );
}

const NOTIFICATION_TYPES: {
  key: keyof EmailConfig['notifications'];
  label: string;
  description: string;
  details: string[];
  scheduleType: 'daily' | 'weekly';
}[] = [
  {
    key: 'dailyDigest',
    label: 'Daily Digest',
    description: 'A morning snapshot of your budget.',
    details: [
      'Overspent categories',
      'Upcoming scheduled payments in the next 7 days',
      'Month-to-date income vs spending',
    ],
    scheduleType: 'daily',
  },
  {
    key: 'weeklySummary',
    label: 'Weekly Summary',
    description: 'A full weekly report.',
    details: [
      'Spending breakdown by category group',
      'Month-over-month comparison',
      'All account balances',
    ],
    scheduleType: 'weekly',
  },
];

async function apiFetch(
  serverURL: string,
  path: string,
  options: RequestInit = {},
) {
  const token = await asyncStorage.getItem('user-token');
  return fetch(`${serverURL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-actual-token': token ?? '',
      ...(options.headers ?? {}),
    },
  });
}

const DEFAULT_CONFIG: EmailConfig = {
  notifyEmail: '',
  fromEmail: '',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPasswordSet: false,
  timezone: 'Europe/Paris',
  notifications: {
    dailyDigest: { enabled: false, cron: '0 8 * * *' },
    weeklySummary: { enabled: false, cron: '0 9 * * 0' },
  },
};

export function EmailNotificationsSettings() {
  const { t } = useTranslation();
  const serverURL = useServerURL();
  const serverStatus = useSyncServerStatus();

  const [config, setConfig] = useState<EmailConfig>(DEFAULT_CONFIG);
  const [smtpPassword, setSmtpPassword] = useState('');
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [testStatus, setTestStatus] = useState<
    'idle' | 'sending' | 'ok' | 'error'
  >('idle');
  const [testError, setTestError] = useState('');

  useEffect(() => {
    if (!serverURL || serverStatus !== 'online') return;
    apiFetch(serverURL, '/email-settings')
      .then(r => r.json())
      .then(data => setConfig(data))
      .catch(_e => console.warn('Failed to load email settings', _e));
  }, [serverURL, serverStatus]);

  if (serverStatus === 'no-server' || serverStatus === 'offline') {
    return null;
  }

  async function onSave() {
    if (!serverURL) return;
    setSaveStatus('saving');
    try {
      const body: Record<string, unknown> = { ...config };
      if (smtpPassword) body.smtpPassword = smtpPassword;
      const res = await apiFetch(serverURL, '/email-settings', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaveStatus('saved');
        setSmtpPassword('');
        setConfig(c => ({
          ...c,
          smtpPasswordSet: c.smtpPasswordSet || !!smtpPassword,
        }));
        setTimeout(() => setSaveStatus('idle'), 2500);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }
  }

  async function onTest() {
    if (!serverURL) return;
    setTestStatus('sending');
    setTestError('');
    try {
      const res = await apiFetch(serverURL, '/email-settings/test', {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setTestStatus('ok');
        setTimeout(() => setTestStatus('idle'), 3000);
      } else {
        setTestStatus('error');
        setTestError(data.reason ?? 'Unknown error');
      }
    } catch (e) {
      setTestStatus('error');
      setTestError(String(e));
    }
  }

  function setNotification(
    key: keyof EmailConfig['notifications'],
    patch: Partial<NotificationConfig>,
  ) {
    setConfig(c => ({
      ...c,
      notifications: {
        ...c.notifications,
        [key]: { ...c.notifications[key], ...patch },
      },
    }));
  }

  const inputStyle = { marginTop: 4 };

  return (
    <Setting
      primaryAction={
        <View
          style={{
            gap: 8,
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Button
            variant="primary"
            onPress={onSave}
            isDisabled={saveStatus === 'saving'}
          >
            {saveStatus === 'saving'
              ? t('Saving…')
              : saveStatus === 'saved'
                ? t('Saved ✓')
                : t('Save')}
          </Button>
          <Button
            variant="normal"
            onPress={onTest}
            isDisabled={
              testStatus === 'sending' ||
              !config.smtpHost ||
              !config.notifyEmail
            }
          >
            {testStatus === 'sending' ? t('Sending…') : t('Send test email')}
          </Button>
          {testStatus === 'ok' && (
            <Text style={{ color: theme.noticeText, fontSize: 13 }}>
              <Trans>✓ Test email sent!</Trans>
            </Text>
          )}
          {testStatus === 'error' && (
            <Text style={{ color: theme.errorText, fontSize: 13 }}>
              ✗ {testError}
            </Text>
          )}
          {saveStatus === 'error' && (
            <Text style={{ color: theme.errorText, fontSize: 13 }}>
              <Trans>Save failed</Trans>
            </Text>
          )}
        </View>
      }
    >
      <Text style={{ fontSize: 15, fontWeight: '600' }}>
        <Trans>Email Notifications</Trans>
      </Text>
      <Text
        style={{
          color: theme.pageTextLight,
          fontSize: 13,
          lineHeight: '1.5em',
        }}
      >
        <Trans>
          Configure your SMTP server, then choose which notifications to
          receive. All settings are stored on the server and take effect
          immediately.
        </Trans>
      </Text>

      {/* ── SMTP Configuration ── */}
      <Text
        style={{
          fontSize: 13,
          fontWeight: '600',
          marginTop: 16,
          marginBottom: 2,
        }}
      >
        <Trans>SMTP Configuration</Trans>
      </Text>

      <View
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px 16px',
        }}
      >
        <FormField>
          <FormLabel title={t('Recipient email')} htmlFor="email-notify" />
          <Input
            id="email-notify"
            style={inputStyle}
            value={config.notifyEmail}
            placeholder="you@example.com"
            onChangeValue={v => setConfig(c => ({ ...c, notifyEmail: v }))}
          />
        </FormField>

        <FormField>
          <FormLabel title={t('From address')} htmlFor="email-from" />
          <Input
            id="email-from"
            style={inputStyle}
            value={config.fromEmail}
            placeholder="Budget <budget@example.com>"
            onChangeValue={v => setConfig(c => ({ ...c, fromEmail: v }))}
          />
        </FormField>

        <FormField>
          <FormLabel title={t('SMTP host')} htmlFor="email-host" />
          <Input
            id="email-host"
            style={inputStyle}
            value={config.smtpHost}
            placeholder="smtp.example.com"
            onChangeValue={v => setConfig(c => ({ ...c, smtpHost: v }))}
          />
        </FormField>

        <FormField>
          <FormLabel title={t('SMTP port')} htmlFor="email-port" />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
            }}
          >
            <Input
              id="email-port"
              value={String(config.smtpPort)}
              style={{ width: 70 }}
              onChangeValue={v => {
                const n = parseInt(v);
                if (!isNaN(n)) setConfig(c => ({ ...c, smtpPort: n }));
              }}
            />
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Checkbox
                id="email-secure"
                checked={config.smtpSecure}
                onChange={e =>
                  setConfig(c => ({ ...c, smtpSecure: e.target.checked }))
                }
              />
              <label htmlFor="email-secure" style={{ fontSize: 13 }}>
                <Trans>TLS</Trans>
              </label>
            </View>
          </View>
        </FormField>

        <FormField>
          <FormLabel title={t('SMTP username')} htmlFor="email-user" />
          <Input
            id="email-user"
            style={inputStyle}
            value={config.smtpUser}
            placeholder={t('optional')}
            onChangeValue={v => setConfig(c => ({ ...c, smtpUser: v }))}
          />
        </FormField>

        <FormField>
          <FormLabel
            title={
              config.smtpPasswordSet
                ? t('SMTP password (set — leave blank to keep)')
                : t('SMTP password')
            }
            htmlFor="email-pass"
          />
          <Input
            id="email-pass"
            style={inputStyle}
            type="password"
            value={smtpPassword}
            placeholder={config.smtpPasswordSet ? '••••••••' : t('optional')}
            onChangeValue={setSmtpPassword}
          />
        </FormField>

        <FormField style={{ gridColumn: '1 / -1' }}>
          <FormLabel title={t('Timezone')} htmlFor="email-tz" />
          <Input
            id="email-tz"
            style={inputStyle}
            value={config.timezone}
            placeholder={t('Europe/Paris')}
            onChangeValue={v => setConfig(c => ({ ...c, timezone: v }))}
          />
        </FormField>
      </View>

      {/* ── Notifications ── */}
      <Text
        style={{
          fontSize: 13,
          fontWeight: '600',
          marginTop: 20,
          marginBottom: 2,
        }}
      >
        <Trans>Notifications</Trans>
      </Text>
      <Text
        style={{ color: theme.pageTextLight, fontSize: 12, marginBottom: 10 }}
      >
        <Trans>Choose which emails to receive and when to send them.</Trans>
      </Text>

      <View style={{ gap: 10 }}>
        {NOTIFICATION_TYPES.map(type => {
          const notif = config.notifications[type.key];
          return (
            <View
              key={type.key}
              style={{
                border: `1px solid ${notif.enabled ? theme.buttonPrimaryBackground : theme.tableBorder}`,
                borderRadius: 6,
                padding: '12px 14px',
                gap: 8,
                backgroundColor: notif.enabled
                  ? theme.buttonPrimaryBackground + '0d'
                  : theme.tableBackground,
              }}
            >
              {/* Header row */}
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Checkbox
                  id={`notif-${type.key}`}
                  checked={notif.enabled}
                  onChange={e =>
                    setNotification(type.key, { enabled: e.target.checked })
                  }
                />
                <View style={{ flex: 1 }}>
                  <label
                    htmlFor={`notif-${type.key}`}
                    style={{
                      fontSize: 13,
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    {type.label}
                  </label>
                  <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>
                    {type.description}
                  </Text>
                </View>
              </View>

              {/* Details list */}
              <View style={{ paddingLeft: 30, gap: 2 }}>
                {type.details.map(detail => (
                  <Text
                    key={detail}
                    style={{ color: theme.pageTextLight, fontSize: 12 }}
                  >
                    · {detail}
                  </Text>
                ))}
              </View>

              {/* Schedule picker */}
              <View
                style={{
                  paddingLeft: 30,
                  opacity: notif.enabled ? 1 : 0.45,
                  pointerEvents: notif.enabled ? 'auto' : 'none',
                }}
              >
                {type.scheduleType === 'daily' ? (
                  <DailyScheduleInput
                    cron={notif.cron}
                    onChange={cron => setNotification(type.key, { cron })}
                  />
                ) : (
                  <WeeklyScheduleInput
                    cron={notif.cron}
                    onChange={cron => setNotification(type.key, { cron })}
                  />
                )}
              </View>
            </View>
          );
        })}
      </View>
    </Setting>
  );
}
