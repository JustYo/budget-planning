import * as asyncStorage from '../../platform/server/asyncStorage';
import { createApp } from '../app';
import { getServer } from '../server-config';

type NotificationConfig = {
  enabled: boolean;
  cron: string;
};

type EmailSettings = {
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

type SaveEmailSettings = Omit<EmailSettings, 'smtpPasswordSet'> & {
  smtpPassword?: string;
};

export type EmailHandlers = {
  'email-settings-get': () => Promise<EmailSettings>;
  'email-settings-save': (fields: SaveEmailSettings) => Promise<void>;
  'email-settings-test': () => Promise<{ ok: boolean; error?: string }>;
};

export const app = createApp<EmailHandlers>();
app.method('email-settings-get', getEmailSettings);
app.method('email-settings-save', saveEmailSettings);
app.method('email-settings-test', testEmailSettings);

async function authHeaders() {
  const token = await asyncStorage.getItem('user-token');
  return {
    'Content-Type': 'application/json',
    'x-actual-token': token ?? '',
  };
}

function serverBase() {
  const server = getServer();
  if (!server) throw new Error('No sync server configured');
  return server.BASE_SERVER;
}

async function getEmailSettings(): Promise<EmailSettings> {
  const res = await fetch(`${serverBase()}/email-settings`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const data = (await res.json()) as { reason?: string };
    throw new Error(data.reason ?? 'Failed to load email settings');
  }
  return res.json() as Promise<EmailSettings>;
}

async function saveEmailSettings(fields: SaveEmailSettings): Promise<void> {
  const res = await fetch(`${serverBase()}/email-settings`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const data = (await res.json()) as { reason?: string };
    throw new Error(data.reason ?? 'Failed to save email settings');
  }
}

async function testEmailSettings(): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${serverBase()}/email-settings/test`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const data = (await res.json()) as { status: string; reason?: string };
  if (res.ok) return { ok: true };
  return { ok: false, error: data.reason ?? 'Unknown error' };
}
