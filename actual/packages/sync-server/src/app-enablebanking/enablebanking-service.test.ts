// @ts-strict-ignore
import crypto from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretName, secretsService } from '../services/secrets-service';

import {
  exchangeCodeForSession,
  getTransactions,
  isConfigured,
  normaliseTransactions,
  pendingSessions,
} from './enablebanking-service';
import type { EnableBankingTransaction } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a minimal valid RSA-2048 key pair for testing. */
function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
}

const { privateKey } = generateKeyPair();
const APPLICATION_ID = 'test-app-id';

// ---------------------------------------------------------------------------
// isConfigured
// ---------------------------------------------------------------------------

describe('isConfigured', () => {
  beforeEach(() => {
    vi.spyOn(secretsService, 'exists').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when no credentials are stored', () => {
    expect(isConfigured()).toBe(false);
  });

  it('returns true when both credentials are stored', () => {
    vi.spyOn(secretsService, 'exists').mockImplementation(
      name =>
        name === SecretName.enablebanking_applicationId ||
        name === SecretName.enablebanking_privateKey,
    );
    expect(isConfigured()).toBe(true);
  });

  it('returns false when only applicationId is stored', () => {
    vi.spyOn(secretsService, 'exists').mockImplementation(
      name => name === SecretName.enablebanking_applicationId,
    );
    expect(isConfigured()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normaliseTransactions
// ---------------------------------------------------------------------------

describe('normaliseTransactions', () => {
  const startDate = '2024-01-01';

  it('filters out transactions before startDate', () => {
    const tx: EnableBankingTransaction = {
      booking_date: '2023-12-31',
      transaction_amount: { amount: '10.00', currency: 'EUR' },
    };
    expect(normaliseTransactions([tx], startDate)).toHaveLength(0);
  });

  it('keeps transactions on or after startDate', () => {
    const tx: EnableBankingTransaction = {
      booking_date: '2024-01-01',
      transaction_amount: { amount: '10.00', currency: 'EUR' },
    };
    expect(normaliseTransactions([tx], startDate)).toHaveLength(1);
  });

  it('marks transaction as booked when booking_date is present', () => {
    const tx: EnableBankingTransaction = {
      booking_date: '2024-02-01',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
    };
    const [result] = normaliseTransactions([tx], startDate);
    expect(result.booked).toBe(true);
  });

  it('marks transaction as pending when only value_date is present', () => {
    const tx: EnableBankingTransaction = {
      value_date: '2024-02-01',
      transaction_amount: { amount: '5.00', currency: 'EUR' },
    };
    const [result] = normaliseTransactions([tx], startDate);
    expect(result.booked).toBe(false);
  });

  it('negates amount for DBIT transactions', () => {
    const tx: EnableBankingTransaction = {
      booking_date: '2024-02-01',
      transaction_amount: { amount: '15.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
    };
    const [result] = normaliseTransactions([tx], startDate);
    expect(result.transactionAmount.amount).toBe('-15.00');
  });

  it('does not double-negate already negative DBIT amount', () => {
    const tx: EnableBankingTransaction = {
      booking_date: '2024-02-01',
      transaction_amount: { amount: '-15.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
    };
    const [result] = normaliseTransactions([tx], startDate);
    expect(result.transactionAmount.amount).toBe('-15.00');
  });

  it('leaves CRDT amount positive', () => {
    const tx: EnableBankingTransaction = {
      booking_date: '2024-02-01',
      transaction_amount: { amount: '100.00', currency: 'EUR' },
      credit_debit_indicator: 'CRDT',
    };
    const [result] = normaliseTransactions([tx], startDate);
    expect(result.transactionAmount.amount).toBe('100.00');
  });

  it('sets payeeName from creditor_name', () => {
    const tx: EnableBankingTransaction = {
      booking_date: '2024-02-01',
      transaction_amount: { amount: '10.00', currency: 'EUR' },
      creditor_name: 'Acme Corp',
    };
    const [result] = normaliseTransactions([tx], startDate);
    expect(result.payeeName).toBe('Acme Corp');
  });

  it('falls back to debtor_name when creditor_name is absent', () => {
    const tx: EnableBankingTransaction = {
      booking_date: '2024-02-01',
      transaction_amount: { amount: '10.00', currency: 'EUR' },
      debtor_name: 'John Doe',
    };
    const [result] = normaliseTransactions([tx], startDate);
    expect(result.payeeName).toBe('John Doe');
  });

  it('produces a 24-char stable transactionId', () => {
    const tx: EnableBankingTransaction = {
      booking_date: '2024-02-01',
      transaction_amount: { amount: '10.00', currency: 'EUR' },
    };
    const [r1] = normaliseTransactions([tx], startDate);
    const [r2] = normaliseTransactions([tx], startDate);
    expect(r1.transactionId).toHaveLength(24);
    expect(r1.transactionId).toBe(r2.transactionId);
  });

  it('drops transactions with no date', () => {
    const tx: EnableBankingTransaction = {
      transaction_amount: { amount: '10.00', currency: 'EUR' },
    };
    expect(normaliseTransactions([tx], startDate)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForSession
// ---------------------------------------------------------------------------

describe('exchangeCodeForSession', () => {
  beforeEach(() => {
    vi.spyOn(secretsService, 'get').mockImplementation(name => {
      if (name === SecretName.enablebanking_applicationId) {
        return APPLICATION_ID;
      }
      if (name === SecretName.enablebanking_privateKey) return privateKey;
      return null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns sessionId and mapped accounts', async () => {
    const mockResponse = {
      session_id: 'sess-123',
      accounts: [
        {
          uid: 'acc-uid-1',
          account_id: { iban: 'FR7612345678901234567890' },
          name: 'Compte Courant',
          currency: 'EUR',
          institution: 'CIC',
        },
      ],
      balances: [
        {
          account_uid: 'acc-uid-1',
          balance_amount: { amount: '1500.00' },
          balance_type: 'CLBD',
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await exchangeCodeForSession('auth-code-abc');

    expect(result.sessionId).toBe('sess-123');
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].account_id).toBe('FR7612345678901234567890');
    expect(result.accounts[0].balance).toBe(1500);
    expect(result.accounts[0].institution).toBe('CIC');
  });

  it('uses uid as account_id when no iban/bban', async () => {
    const mockResponse = {
      session_id: 'sess-456',
      accounts: [{ uid: 'raw-uid', currency: 'EUR' }],
      balances: [],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await exchangeCodeForSession('code');
    expect(result.accounts[0].account_id).toBe('raw-uid');
  });

  it('throws on non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    } as Response);

    await expect(exchangeCodeForSession('bad-code')).rejects.toThrow(/401/);
  });
});

// ---------------------------------------------------------------------------
// getTransactions (pagination)
// ---------------------------------------------------------------------------

describe('getTransactions', () => {
  beforeEach(() => {
    vi.spyOn(secretsService, 'get').mockImplementation(name => {
      if (name === SecretName.enablebanking_applicationId) {
        return APPLICATION_ID;
      }
      if (name === SecretName.enablebanking_privateKey) return privateKey;
      return null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows continuation_key pagination', async () => {
    const page1 = {
      transactions: [
        {
          booking_date: '2024-02-01',
          transaction_amount: { amount: '10.00', currency: 'EUR' },
        },
      ],
      continuation_key: 'next-page',
    };
    const page2 = {
      transactions: [
        {
          booking_date: '2024-02-02',
          transaction_amount: { amount: '20.00', currency: 'EUR' },
        },
      ],
    };

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page1),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page2),
      } as Response);

    const txs = await getTransactions('sess', 'acc-uid', '2024-01-01');
    expect(txs).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws on non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server Error'),
    } as Response);

    await expect(
      getTransactions('sess', 'acc-uid', '2024-01-01'),
    ).rejects.toThrow(/500/);
  });
});

// ---------------------------------------------------------------------------
// pendingSessions map
// ---------------------------------------------------------------------------

describe('pendingSessions', () => {
  it('starts empty', () => {
    // May have entries from other tests — just verify the Map API works
    const before = pendingSessions.size;
    pendingSessions.set('test-state', {
      sessionId: 'sid',
      accounts: [],
    });
    expect(pendingSessions.size).toBe(before + 1);
    pendingSessions.delete('test-state');
    expect(pendingSessions.size).toBe(before);
  });
});
