// @ts-strict-ignore
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handlers as app, ebCallbackHandler } from './app-enablebanking';
import * as ebService from './enablebanking-service';

// Minimal app that mounts ebCallbackHandler at /callback for isolated testing.
const callbackApp = express();
callbackApp.get('/callback', ebCallbackHandler);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bypass session validation for route tests. */
vi.mock('../util/middlewares', () => ({
  requestLoggerMiddleware: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  validateSessionMiddleware: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// ---------------------------------------------------------------------------
// POST /status
// ---------------------------------------------------------------------------

describe('POST /status', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports configured: true when service is configured', async () => {
    vi.spyOn(ebService, 'isConfigured').mockReturnValue(true);

    const res = await request(app).post('/status').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      data: { configured: true },
    });
  });

  it('reports configured: false when service is not configured', async () => {
    vi.spyOn(ebService, 'isConfigured').mockReturnValue(false);

    const res = await request(app).post('/status').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      data: { configured: false },
    });
  });
});

// ---------------------------------------------------------------------------
// POST /create-web-token
// ---------------------------------------------------------------------------

describe('POST /create-web-token', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns link and state', async () => {
    vi.spyOn(ebService, 'getRedirectUrl').mockReturnValue(
      'https://importer.ops.quest/eb-callback',
    );
    vi.spyOn(ebService, 'createAuthSession').mockResolvedValue(
      'https://enablebanking.com/auth?state=abc',
    );

    const res = await request(app)
      .post('/create-web-token')
      .send({ aspspName: 'CIC', aspspCountry: 'FR' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.data).toHaveProperty('link');
    expect(res.body.data).toHaveProperty('state');
    expect(typeof res.body.data.state).toBe('string');
  });

  it('uses default aspspName/aspspCountry when not provided', async () => {
    vi.spyOn(ebService, 'getRedirectUrl').mockReturnValue(
      'https://importer.ops.quest/eb-callback',
    );
    const createAuthSession = vi
      .spyOn(ebService, 'createAuthSession')
      .mockResolvedValue('https://enablebanking.com/auth?state=xyz');

    await request(app).post('/create-web-token').send({});

    expect(createAuthSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'CIC',
      'FR',
    );
  });
});

// ---------------------------------------------------------------------------
// POST /get-accounts
// ---------------------------------------------------------------------------

describe('POST /get-accounts', () => {
  afterEach(() => {
    ebService.pendingSessions.clear();
    vi.restoreAllMocks();
  });

  it('returns null when state is absent', async () => {
    const res = await request(app).post('/get-accounts').send({});
    expect(res.body).toMatchObject({ status: 'ok', data: null });
  });

  it('returns null when state has no matching pending session', async () => {
    const res = await request(app)
      .post('/get-accounts')
      .send({ state: 'non-existent-state' });
    expect(res.body).toMatchObject({ status: 'ok', data: null });
  });

  it('returns and removes the session when state matches', async () => {
    const state = 'known-state';
    ebService.pendingSessions.set(state, {
      sessionId: 'sess-789',
      accounts: [
        {
          uid: 'acc-1',
          account_id: 'FR76000',
          name: 'Compte',
          balance: 1000,
        },
      ],
    });

    const res = await request(app).post('/get-accounts').send({ state });

    expect(res.status).toBe(200);
    expect(res.body.data.sessionId).toBe('sess-789');
    expect(res.body.data.accounts).toHaveLength(1);

    // Session must be consumed
    expect(ebService.pendingSessions.has(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /transactions
// ---------------------------------------------------------------------------

describe('POST /transactions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns MISSING_PARAMS when required fields are absent', async () => {
    const res = await request(app).post('/transactions').send({});
    expect(res.body.data).toMatchObject({
      error_type: 'INVALID_INPUT',
      error_code: 'MISSING_PARAMS',
    });
  });

  it('returns normalised transactions and startingBalance', async () => {
    const rawTx = [
      {
        booking_date: '2024-03-01',
        transaction_amount: { amount: '50.00', currency: 'EUR' },
        creditor_name: 'Supermarché',
        credit_debit_indicator: 'DBIT',
      },
    ];
    const rawBalances = [
      {
        balance_type: 'CLBD',
        balance_amount: { amount: '500.00', currency: 'EUR' },
      },
    ];

    vi.spyOn(ebService, 'getTransactions').mockResolvedValue(rawTx as never);
    vi.spyOn(ebService, 'getBalances').mockResolvedValue(rawBalances as never);

    const res = await request(app).post('/transactions').send({
      sessionId: 'sess-abc',
      accountUid: 'acc-uid-1',
      startDate: '2024-01-01',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.data.startingBalance).toBe(50000); // 500.00 * 100
    expect(res.body.data.transactions.booked).toHaveLength(1);
    expect(res.body.data.transactions.booked[0].transactionAmount.amount).toBe(
      '-50.00',
    );
  });

  it('returns ITEM_LOGIN_REQUIRED on auth errors (401)', async () => {
    vi.spyOn(ebService, 'getTransactions').mockRejectedValue(
      new Error('Enable Banking /transactions returned 401: Unauthorized'),
    );
    vi.spyOn(ebService, 'getBalances').mockRejectedValue(
      new Error('Enable Banking /balances returned 401: Unauthorized'),
    );

    const res = await request(app).post('/transactions').send({
      sessionId: 'sess-expired',
      accountUid: 'acc-uid',
      startDate: '2024-01-01',
    });

    expect(res.body.data).toMatchObject({
      error_type: 'ITEM_ERROR',
      error_code: 'ITEM_LOGIN_REQUIRED',
    });
  });

  it('returns ENABLEBANKING_ERROR on generic errors', async () => {
    vi.spyOn(ebService, 'getTransactions').mockRejectedValue(
      new Error('Network timeout'),
    );
    vi.spyOn(ebService, 'getBalances').mockRejectedValue(
      new Error('Network timeout'),
    );

    const res = await request(app).post('/transactions').send({
      sessionId: 'sess-abc',
      accountUid: 'acc-uid',
      startDate: '2024-01-01',
    });

    expect(res.body.data).toMatchObject({
      error_type: 'SYNC_ERROR',
      error_code: 'ENABLEBANKING_ERROR',
    });
  });
});

// ---------------------------------------------------------------------------
// GET /callback
// ---------------------------------------------------------------------------

describe('GET /callback', () => {
  afterEach(() => {
    ebService.pendingSessions.clear();
    vi.restoreAllMocks();
  });

  it('returns 400 when code or state is missing', async () => {
    const res = await request(callbackApp)
      .get('/callback')
      .query({ code: 'abc' });
    expect(res.status).toBe(400);
  });

  it('stores session in pendingSessions on success', async () => {
    vi.spyOn(ebService, 'exchangeCodeForSession').mockResolvedValue({
      sessionId: 'sess-new',
      accounts: [],
    });

    // sendFile will fail in test env — catch 500 but verify side effect
    await request(callbackApp)
      .get('/callback')
      .query({ code: 'auth-code', state: 'my-state' });

    expect(ebService.pendingSessions.get('my-state')).toMatchObject({
      sessionId: 'sess-new',
    });
  });

  it('returns 500 when exchangeCodeForSession throws', async () => {
    vi.spyOn(ebService, 'exchangeCodeForSession').mockRejectedValue(
      new Error('Bad code'),
    );

    const res = await request(callbackApp)
      .get('/callback')
      .query({ code: 'bad', state: 'st' });

    expect(res.status).toBe(500);
  });
});
