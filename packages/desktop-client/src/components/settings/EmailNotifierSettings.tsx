// @ts-strict-ignore
import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { Checkbox, FormField, FormLabel } from '#components/forms';
import { useServerURL } from '#components/ServerContext';

import { Setting } from './UI';

type Notifications = {
  dailyDigest: { enabled: boolean; cron: string };
  weeklySummary: { enabled: boolean; cron: string };
};

type EmailConfig = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPasswordSet: boolean;
  fromEmail: string;
  notifyEmail: string;
  timezone: string;
  notifications: Notifications;
};

const DAYS_OF_WEEK: [string, string][] = [
  ['0', 'Sunday'],
  ['1', 'Monday'],
  ['2', 'Tuesday'],
  ['3', 'Wednesday'],
  ['4', 'Thursday'],
  ['5', 'Friday'],
  ['6', 'Saturday'],
];

// Parse "MM HH * * [D]" → { time: "HH:MM", day: "D" | undefined }
function parseCron(cron: string) {
  const parts = cron.trim().split(/\s+/);
  const minute = parts[0] ?? '0';
  const hour = parts[1] ?? '8';
  const day = parts[4] !== '*' ? parts[4] : undefined;
  const hh = hour.padStart(2, '0');
  const mm = minute.padStart(2, '0');
  return { time: `${hh}:${mm}`, day };
}

// Build cron from time "HH:MM" and optional day index
function buildCron(time: string, day?: string) {
  const [hh, mm] = time.split(':');
  const minute = mm ?? '0';
  const hour = hh ?? '8';
  return day !== undefined
    ? `${minute} ${hour} * * ${day}`
    : `${minute} ${hour} * * *`;
}

const defaultConfig: EmailConfig = {
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPasswordSet: false,
  fromEmail: '',
  notifyEmail: '',
  timezone: 'Europe/Paris',
  notifications: {
    dailyDigest: { enabled: false, cron: '0 8 * * *' },
    weeklySummary: { enabled: false, cron: '0 8 * * 0' },
  },
};

export function EmailNotifierSettings() {
  const { t } = useTranslation();
  const serverURL = useServerURL();

  const [config, setConfig] = useState<EmailConfig>(defaultConfig);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  // Parse cron strings to time/day for the inputs
  const daily = parseCron(config.notifications.dailyDigest.cron);
  const weekly = parseCron(config.notifications.weeklySummary.cron);

  useEffect(() => {
    if (!serverURL) return;
    fetch(`${serverURL}/email-settings`)
      .then(r => r.json())
      .then((data: Partial<EmailConfig>) => {
        setConfig({
          ...defaultConfig,
          ...data,
          notifications: {
            ...defaultConfig.notifications,
            ...(data.notifications ?? {}),
          },
        });
      })
      .catch(() => {
        // server may not have the endpoint yet — use defaults
      })
      .finally(() => setLoading(false));
  }, [serverURL]);

  function setNotification(
    type: keyof Notifications,
    key: 'enabled' | 'cron',
    value: boolean | string,
  ) {
    setConfig(prev => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [type]: { ...prev.notifications[type], [key]: value },
      },
    }));
    setMessage(null);
  }

  function setDailyTime(time: string) {
    setNotification('dailyDigest', 'cron', buildCron(time));
  }

  function setWeeklyTime(time: string) {
    const { day } = parseCron(config.notifications.weeklySummary.cron);
    setNotification('weeklySummary', 'cron', buildCron(time, day ?? '0'));
  }

  function setWeeklyDay(day: string) {
    const { time } = parseCron(config.notifications.weeklySummary.cron);
    setNotification('weeklySummary', 'cron', buildCron(time, day));
  }

  async function onSave() {
    if (!serverURL) return;
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = { ...config };
      if (password) body.smtpPassword = password;
      delete body.smtpPasswordSet;
      const res = await fetch(`${serverURL}/email-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setMessage({ text: t('Settings saved.'), error: false });
        setPassword('');
        // Refresh to get updated smtpPasswordSet
        const updated = await fetch(`${serverURL}/email-settings`).then(r =>
          r.json(),
        );
        setConfig(prev => ({
          ...prev,
          smtpPasswordSet: updated.smtpPasswordSet ?? prev.smtpPasswordSet,
        }));
      } else {
        setMessage({ text: t('Failed to save settings.'), error: true });
      }
    } catch {
      setMessage({ text: t('Could not reach the server.'), error: true });
    }
    setSaving(false);
  }

  async function onTest() {
    if (!serverURL) return;
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch(`${serverURL}/email-settings/test`, {
        method: 'POST',
      });
      if (res.ok) {
        setMessage({ text: t('Test email sent!'), error: false });
      } else {
        const body = await res.json().catch(() => ({}));
        setMessage({
          text: body.reason ?? t('Failed to send test email.'),
          error: true,
        });
      }
    } catch {
      setMessage({ text: t('Could not reach the server.'), error: true });
    }
    setTesting(false);
  }

  if (loading) return null;

  const inputStyle = { width: '100%', maxWidth: 320 };
  const fieldStyle = { marginBottom: 8 };
  const sectionTitleStyle = {
    fontWeight: 600,
    fontSize: 13,
    marginBottom: 8,
    marginTop: 4,
    color: theme.pageText,
  };
  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  return (
    <Setting
      primaryAction={
        <View style={{ gap: 8 }}>
          <View style={rowStyle}>
            <ButtonWithLoading onPress={onSave} isLoading={saving}>
              <Trans>Save</Trans>
            </ButtonWithLoading>
            <ButtonWithLoading
              onPress={onTest}
              isLoading={testing}
              style={{ backgroundColor: theme.buttonNormalBackground }}
            >
              <Trans>Send test email</Trans>
            </ButtonWithLoading>
          </View>
          {message && (
            <Text
              style={{
                color: message.error ? theme.errorText : theme.noticeText,
                fontSize: 13,
              }}
            >
              {message.text}
            </Text>
          )}
        </View>
      }
    >
      <Text>
        <Trans>
          <strong>Email Notifications</strong> — configure the email notifier
          running alongside the sync server. Emails are sent on the schedule
          below from the server.
        </Trans>
      </Text>

      {/* SMTP */}
      <View>
        <Text style={sectionTitleStyle}>
          <Trans>SMTP Server</Trans>
        </Text>
        <View style={{ gap: 6 }}>
          <FormField style={fieldStyle}>
            <FormLabel title={t('Host')} />
            <Input
              value={config.smtpHost}
              placeholder="smtp.example.com"
              style={inputStyle}
              onChangeValue={v => {
                setConfig(p => ({ ...p, smtpHost: v }));
                setMessage(null);
              }}
            />
          </FormField>

          <View style={rowStyle}>
            <FormField style={{ ...fieldStyle, flex: 1 }}>
              <FormLabel title={t('Port')} />
              <Input
                value={String(config.smtpPort)}
                style={{ width: 80 }}
                onChangeValue={v => {
                  const n = parseInt(v);
                  if (!isNaN(n)) {
                    setConfig(p => ({ ...p, smtpPort: n }));
                    setMessage(null);
                  }
                }}
              />
            </FormField>
            <FormField
              style={{
                ...fieldStyle,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingTop: 18,
              }}
            >
              <Checkbox
                id="smtp-secure"
                checked={config.smtpSecure}
                onChange={e => {
                  setConfig(p => ({ ...p, smtpSecure: e.target.checked }));
                  setMessage(null);
                }}
              />
              <label
                htmlFor="smtp-secure"
                style={{ fontSize: 13, cursor: 'pointer' }}
              >
                <Trans>TLS/SSL</Trans>
              </label>
            </FormField>
          </View>

          <FormField style={fieldStyle}>
            <FormLabel title={t('Username')} />
            <Input
              value={config.smtpUser}
              style={inputStyle}
              onChangeValue={v => {
                setConfig(p => ({ ...p, smtpUser: v }));
                setMessage(null);
              }}
            />
          </FormField>

          <FormField style={fieldStyle}>
            <FormLabel title={t('Password')} />
            <Input
              type="password"
              value={password}
              placeholder={config.smtpPasswordSet ? '••••••••' : t('Not set')}
              style={inputStyle}
              onChangeValue={v => {
                setPassword(v);
                setMessage(null);
              }}
            />
          </FormField>

          <FormField style={fieldStyle}>
            <FormLabel title={t('From address')} />
            <Input
              value={config.fromEmail}
              placeholder="Budget <server@example.com>"
              style={inputStyle}
              onChangeValue={v => {
                setConfig(p => ({ ...p, fromEmail: v }));
                setMessage(null);
              }}
            />
          </FormField>

          <FormField style={fieldStyle}>
            <FormLabel title={t('Send notifications to')} />
            <Input
              value={config.notifyEmail}
              placeholder="you@example.com"
              style={inputStyle}
              onChangeValue={v => {
                setConfig(p => ({ ...p, notifyEmail: v }));
                setMessage(null);
              }}
            />
          </FormField>
        </View>
      </View>

      {/* Schedule */}
      <View>
        <Text style={sectionTitleStyle}>
          <Trans>Notifications</Trans>
        </Text>
        <View style={{ gap: 8 }}>
          <FormField style={fieldStyle}>
            <FormLabel title={t('Timezone')} />
            <Input
              value={config.timezone}
              placeholder="Europe/Paris"
              style={{ width: 200 }}
              onChangeValue={v => {
                setConfig(p => ({ ...p, timezone: v }));
                setMessage(null);
              }}
            />
          </FormField>

          {/* Daily digest */}
          <View style={rowStyle}>
            <Checkbox
              id="daily-enabled"
              checked={config.notifications.dailyDigest.enabled}
              onChange={e =>
                setNotification('dailyDigest', 'enabled', e.target.checked)
              }
            />
            <label
              htmlFor="daily-enabled"
              style={{ fontSize: 13, cursor: 'pointer', minWidth: 120 }}
            >
              <Trans>Daily digest</Trans>
            </label>
            {config.notifications.dailyDigest.enabled && (
              <Input
                type="time"
                value={daily.time}
                style={{ width: 110 }}
                onChangeValue={setDailyTime}
              />
            )}
          </View>

          {/* Weekly summary */}
          <View style={rowStyle}>
            <Checkbox
              id="weekly-enabled"
              checked={config.notifications.weeklySummary.enabled}
              onChange={e =>
                setNotification('weeklySummary', 'enabled', e.target.checked)
              }
            />
            <label
              htmlFor="weekly-enabled"
              style={{ fontSize: 13, cursor: 'pointer', minWidth: 120 }}
            >
              <Trans>Weekly summary</Trans>
            </label>
            {config.notifications.weeklySummary.enabled && (
              <>
                <Select
                  value={weekly.day ?? '0'}
                  options={DAYS_OF_WEEK}
                  style={{ width: 110 }}
                  onChange={setWeeklyDay}
                />
                <Input
                  type="time"
                  value={weekly.time}
                  style={{ width: 110 }}
                  onChangeValue={setWeeklyTime}
                />
              </>
            )}
          </View>
        </View>
      </View>
    </Setting>
  );
}
