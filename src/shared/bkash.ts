import config from '../config';
import AppError from '../errors/AppError';
import { cacheGet, cacheSet } from './redis';

/**
 * bKash Tokenized Checkout (URL-based, mode "0011").
 *
 * Unlike Stripe, bKash has NO webhook. The merchant server is the only
 * party that can confirm a payment: after bKash redirects the payer back
 * to callbackURL it must call Execute Payment, and Query Payment Status is
 * the authoritative re-check. Both are implemented here.
 */

const GRANT_TOKEN_TTL = 3300; // id_token lives ~1h; refresh a little early
const TOKEN_CACHE_KEY = 'bkash:id_token';

// Falls back to an in-process token when Redis is not configured, so a
// single warm instance still avoids re-granting on every request.
let memoryToken: { token: string; expiresAt: number } | null = null;

type TGrantResponse = {
  id_token?: string;
  statusCode?: string;
  statusMessage?: string;
};

export type TCreatePaymentResponse = {
  paymentID?: string;
  bkashURL?: string;
  statusCode?: string;
  statusMessage?: string;
};

export type TExecutePaymentResponse = {
  paymentID?: string;
  trxID?: string;
  transactionStatus?: string;
  amount?: string;
  currency?: string;
  merchantInvoiceNumber?: string;
  statusCode?: string;
  statusMessage?: string;
};

const assertConfigured = (): void => {
  if (!config.bkash.app_key || !config.bkash.app_secret || !config.bkash.username) {
    throw new AppError(503, 'bKash is not configured on this server');
  }
};

const request = async <T>(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<T> => {
  let response: Response;

  try {
    response = await fetch(`${config.bkash.base_url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new AppError(502, `Could not reach bKash: ${(error as Error).message}`);
  }

  const text = await response.text();

  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new AppError(
      502,
      `bKash returned a non-JSON response (HTTP ${response.status})`
    );
  }

  return parsed;
};

/** Grants (and caches) the id_token every other bKash call needs. */
const getToken = async (): Promise<string> => {
  assertConfigured();

  const cached = await cacheGet<string>(TOKEN_CACHE_KEY);
  if (cached) return cached;

  if (memoryToken && memoryToken.expiresAt > Date.now()) {
    return memoryToken.token;
  }

  const data = await request<TGrantResponse>(
    '/tokenized/checkout/token/grant',
    { app_key: config.bkash.app_key, app_secret: config.bkash.app_secret },
    { username: config.bkash.username, password: config.bkash.password }
  );

  if (!data.id_token) {
    throw new AppError(
      502,
      `bKash token grant failed: ${data.statusMessage ?? 'no id_token returned'}`
    );
  }

  await cacheSet(TOKEN_CACHE_KEY, data.id_token, GRANT_TOKEN_TTL);
  memoryToken = {
    token: data.id_token,
    expiresAt: Date.now() + GRANT_TOKEN_TTL * 1000,
  };

  return data.id_token;
};

const authHeaders = async (): Promise<Record<string, string>> => ({
  Authorization: await getToken(),
  'X-APP-Key': config.bkash.app_key,
});

/** Step 2: create the payment and get the hosted bKash URL. */
export const createPayment = async (payload: {
  amount: number;
  merchantInvoiceNumber: string;
  payerReference: string;
}): Promise<TCreatePaymentResponse> => {
  const data = await request<TCreatePaymentResponse>(
    '/tokenized/checkout/create',
    {
      // "0011" is the URL-based checkout mode, which redirects the payer to
      // a bKash-hosted page and back to our callbackURL.
      mode: '0011',
      payerReference: payload.payerReference,
      callbackURL: config.bkash.callback_url,
      amount: payload.amount.toFixed(2),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: payload.merchantInvoiceNumber,
    },
    await authHeaders()
  );

  if (!data.paymentID || !data.bkashURL) {
    throw new AppError(
      502,
      `bKash could not create the payment: ${data.statusMessage ?? 'unknown error'}`
    );
  }

  return data;
};

/** Step 4: finalise the payment after the payer returns. */
export const executePayment = async (
  paymentID: string
): Promise<TExecutePaymentResponse> =>
  request<TExecutePaymentResponse>(
    '/tokenized/checkout/execute',
    { paymentID },
    await authHeaders()
  );

/**
 * Step 5: authoritative status check. Used both as a fallback when Execute
 * reports an already-executed payment, and by the manual verify endpoint.
 */
export const queryPayment = async (
  paymentID: string
): Promise<TExecutePaymentResponse> =>
  request<TExecutePaymentResponse>(
    '/tokenized/checkout/payment/status',
    { paymentID },
    await authHeaders()
  );

export const isBkashConfigured = (): boolean =>
  Boolean(config.bkash.app_key && config.bkash.app_secret && config.bkash.username);
