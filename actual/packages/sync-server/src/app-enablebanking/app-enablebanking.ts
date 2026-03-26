import { randomUUID } from 'node:crypto';
import path from 'node:path';

import express from 'express';
import type { Request, Response } from 'express';

import { handleError } from '../app-gocardless/util/handle-error';
import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from '../util/middlewares';

import * as ebService from './enablebanking-service';

const app = express();
app.use(requestLoggerMiddleware);

export { app as handlers };

/**
 * OAuth2 callback — called by Enable Banking after the user authorises.
 * Registered at GET /eb-callback in app.ts so it matches the redirect URL
 * https://importer.ops.quest/eb-callback that is configured in the Enable
 * Banking developer portal.
 *
 * Exchanges the authorisation code for a session, stores accounts in memory
 * keyed by state UUID, and renders a simple success page.
 */
export async function ebCallbackHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state) {
    res.status(400).send('Missing code or state parameter');
    return;
  }

  try {
    const { sessionId, accounts } =
      await ebService.exchangeCodeForSession(code);
    ebService.pendingSessions.set(state, { sessionId, accounts });

    res.sendFile('callback.html', {
      root: path.resolve('./src/app-enablebanking'),
    });
  } catch (err) {
    console.error('Enable Banking callback error:', err);
    res.status(500).send('Failed to exchange code. Please try again.');
  }
}
app.use(express.json());
app.use(validateSessionMiddleware);

app.post(
  '/status',
  handleError(async (_req: Request, res: Response) => {
    res.send({
      status: 'ok',
      data: { configured: ebService.isConfigured() },
    });
  }),
);

/**
 * Start the OAuth2 flow.
 * Returns the Enable Banking authorisation URL that the client should open
 * in a browser, plus the state UUID used for polling.
 */
app.post(
  '/create-web-token',
  handleError(async (req: Request, res: Response) => {
    const { aspspName = 'CIC', aspspCountry = 'FR' } =
      (req.body as { aspspName?: string; aspspCountry?: string }) ?? {};

    const state = randomUUID();
    const redirectUrl = ebService.getRedirectUrl();
    const authUrl = await ebService.createAuthSession(
      redirectUrl,
      state,
      aspspName,
      aspspCountry,
    );

    res.send({ status: 'ok', data: { link: authUrl, state } });
  }),
);

/**
 * Poll for the session after the OAuth2 redirect.
 * Returns accounts once available, or null while still pending.
 */
app.post(
  '/get-accounts',
  handleError(async (req: Request, res: Response) => {
    const { state } = (req.body as { state?: string }) ?? {};

    if (!state) {
      res.send({ status: 'ok', data: null });
      return;
    }

    const session = ebService.pendingSessions.get(state);
    if (!session) {
      res.send({ status: 'ok', data: null });
      return;
    }

    ebService.pendingSessions.delete(state);

    res.send({
      status: 'ok',
      data: {
        sessionId: session.sessionId,
        accounts: session.accounts,
      },
    });
  }),
);

/**
 * Fetch transactions for a linked account.
 * Called during every bank sync.
 */
app.post(
  '/transactions',
  handleError(async (req: Request, res: Response) => {
    const { sessionId, accountUid, startDate } =
      (req.body as {
        sessionId?: string;
        accountUid?: string;
        startDate?: string;
      }) ?? {};

    if (!sessionId || !accountUid || !startDate) {
      res.send({
        status: 'ok',
        data: {
          error_type: 'INVALID_INPUT',
          error_code: 'MISSING_PARAMS',
        },
      });
      return;
    }

    try {
      const [rawTransactions, balances] = await Promise.all([
        ebService.getTransactions(sessionId, accountUid, startDate),
        ebService.getBalances(sessionId, accountUid),
      ]);

      const normalised = ebService.normaliseTransactions(
        rawTransactions,
        startDate,
      );

      const booked = normalised.filter(t => t.booked);
      const pending = normalised.filter(t => !t.booked);

      const clbdBalance = balances.find(b => b.balance_type === 'CLBD');
      const startingBalance = clbdBalance
        ? Math.round(parseFloat(clbdBalance.balance_amount.amount) * 100)
        : 0;

      res.send({
        status: 'ok',
        data: {
          balances,
          startingBalance,
          transactions: { all: normalised, booked, pending },
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Enable Banking /transactions error:', message);

      if (message.includes('401') || message.includes('403')) {
        res.send({
          status: 'ok',
          data: {
            error_type: 'ITEM_ERROR',
            error_code: 'ITEM_LOGIN_REQUIRED',
          },
        });
      } else {
        res.send({
          status: 'ok',
          data: {
            error_type: 'SYNC_ERROR',
            error_code: 'ENABLEBANKING_ERROR',
          },
        });
      }
    }
  }),
);
