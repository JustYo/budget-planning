import crypto from 'node:crypto';

import { SecretName, secretsService } from '../services/secrets-service';

import type {
  EnableBankingBalance,
  EnableBankingTransaction,
  SyncServerEnableBankingAccount,
} from './types';

const API_ORIGIN = 'https://api.enablebanking.com';

// In-memory pending sessions: state UUID → { sessionId, accounts }
export const pendingSessions = new Map<
  string,
  { sessionId: string; accounts: SyncServerEnableBankingAccount[] }
>();

function buildJwt(): string {
  const applicationId = secretsService.get(
    SecretName.enablebanking_applicationId,
  );
  const rawKey = secretsService.get(SecretName.enablebanking_privateKey);

  if (!applicationId || !rawKey) {
    throw new Error('Enable Banking credentials not configured');
  }

  // Normalise the PEM key: convert literal \n sequences to real newlines
  // (common when keys are stored via env vars or JSON), strip CRLF, trim.
  const privateKeyPem = rawKey
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();

  // Parse into a KeyObject — handles both PKCS#1 and PKCS#8 PEM formats and
  // gives a clear error if the key is malformed rather than an opaque OpenSSL
  // decoder error.
  const keyObject = crypto.createPrivateKey(privateKeyPem);

  const iat = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat,
    exp: iat + 3600,
  });

  const header = JSON.stringify({ alg: 'RS256', kid: applicationId });

  const signingInput =
    Buffer.from(header).toString('base64url') +
    '.' +
    Buffer.from(payload).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(keyObject, 'base64url');

  return `${signingInput}.${signature}`;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${buildJwt()}`,
    'Content-Type': 'application/json',
  };
}

export function isConfigured(): boolean {
  return (
    secretsService.exists(SecretName.enablebanking_applicationId) &&
    secretsService.exists(SecretName.enablebanking_privateKey)
  );
}

export function getRedirectUrl(): string {
  const url = process.env.ENABLEBANKING_REDIRECT_URL;
  if (!url) {
    throw new Error(
      'ENABLEBANKING_REDIRECT_URL environment variable is not set',
    );
  }
  return url;
}

export async function createAuthSession(
  redirectUrl: string,
  state: string,
  aspspName: string = 'CIC',
  aspspCountry: string = 'FR',
): Promise<string> {
  const validUntil = new Date(
    Date.now() + 180 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const res = await fetch(`${API_ORIGIN}/auth`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      access: { valid_until: validUntil },
      aspsp: { name: aspspName, country: aspspCountry },
      state,
      redirect_url: redirectUrl,
      psu_type: 'personal',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Enable Banking /auth returned ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { url: string };
  return data.url;
}

export async function exchangeCodeForSession(code: string): Promise<{
  sessionId: string;
  accounts: SyncServerEnableBankingAccount[];
}> {
  const res = await fetch(`${API_ORIGIN}/sessions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Enable Banking /sessions returned ${res.status}: ${body}`);
  }

  const session = (await res.json()) as {
    session_id: string;
    accounts: Array<{
      uid: string;
      account_id?: { iban?: string; bban?: string };
      name?: string;
      currency?: string;
      institution?: string;
    }>;
    balances?: Array<{
      account_uid: string;
      balance_amount: { amount: string };
      balance_type: string;
    }>;
  };

  const balanceMap: Record<string, number> = {};
  for (const b of session.balances ?? []) {
    if (b.balance_type === 'CLBD') {
      balanceMap[b.account_uid] = parseFloat(b.balance_amount.amount);
    }
  }

  const accounts: SyncServerEnableBankingAccount[] = (
    session.accounts ?? []
  ).map(acc => ({
    uid: acc.uid,
    account_id: acc.account_id?.iban ?? acc.account_id?.bban ?? acc.uid,
    name: acc.name ?? acc.account_id?.iban ?? acc.uid,
    institution: acc.institution ?? 'Enable Banking',
    currency: acc.currency,
    balance: balanceMap[acc.uid] ?? 0,
  }));

  return { sessionId: session.session_id, accounts };
}

export async function getTransactions(
  sessionId: string,
  accountUid: string,
  dateFrom: string,
): Promise<EnableBankingTransaction[]> {
  const transactions: EnableBankingTransaction[] = [];
  const query: Record<string, string> = {
    date_from: dateFrom,
    session_id: sessionId,
  };

  while (true) {
    const params = new URLSearchParams(query);
    const res = await fetch(
      `${API_ORIGIN}/accounts/${accountUid}/transactions?${params.toString()}`,
      { headers: authHeaders() },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Enable Banking /transactions returned ${res.status}: ${body}`,
      );
    }

    const data = (await res.json()) as {
      transactions: EnableBankingTransaction[];
      continuation_key?: string;
    };

    transactions.push(...(data.transactions ?? []));

    if (!data.continuation_key) break;
    query['continuation_key'] = data.continuation_key;
  }

  return transactions;
}

export async function getBalances(
  sessionId: string,
  accountUid: string,
): Promise<EnableBankingBalance[]> {
  const res = await fetch(
    `${API_ORIGIN}/accounts/${accountUid}/balances?session_id=${sessionId}`,
    { headers: authHeaders() },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Enable Banking /balances returned ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { balances: EnableBankingBalance[] };
  return data.balances ?? [];
}

/**
 * Normalise Enable Banking transactions into the format expected by Actual's
 * sync pipeline (same shape as GoCardless/SimpleFIN transactions).
 */
export function normaliseTransactions(
  rawTransactions: EnableBankingTransaction[],
  startDate: string,
): Array<{
  date: string;
  payeeName: string | null;
  notes: string;
  transactionAmount: { amount: string; currency: string };
  transactionId: string;
  booked: boolean;
}> {
  const cutoff = new Date(startDate);

  return rawTransactions
    .map(tx => {
      const rawDate = tx.booking_date ?? tx.value_date;
      if (!rawDate) return null;

      const txDate = new Date(rawDate);
      if (txDate < cutoff) return null;

      const remittance = (tx.remittance_information ?? []).join(' ').trim();
      const payeeName =
        tx.creditor_name ?? tx.debtor_name ?? remittance ?? null;

      // CIC doesn't provide unique IDs — build a stable hash
      const hashInput = [
        rawDate,
        tx.transaction_amount.amount,
        tx.credit_debit_indicator ?? '',
        (tx.remittance_information ?? []).join('|'),
      ].join('|');
      const transactionId = crypto
        .createHash('sha256')
        .update(hashInput)
        .digest('hex')
        .slice(0, 24);

      // Convert amount to signed value
      let amount = tx.transaction_amount.amount;
      if (tx.credit_debit_indicator === 'DBIT' && !amount.startsWith('-')) {
        amount = '-' + amount;
      }

      return {
        date: rawDate,
        payeeName,
        notes: remittance,
        transactionAmount: { amount, currency: tx.transaction_amount.currency },
        transactionId,
        booked: Boolean(tx.booking_date),
      };
    })
    .filter((tx): tx is NonNullable<typeof tx> => tx !== null);
}
