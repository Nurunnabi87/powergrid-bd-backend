import Stripe from 'stripe';
import config from '../config';
import AppError from '../errors/AppError';

/**
 * Stripe Checkout (hosted payment page, test mode).
 *
 * The browser is sent to Stripe's hosted page and returns to the frontend's
 * success/cancel URL. That redirect alone proves nothing, so settlement
 * always re-reads the Checkout Session from Stripe's API and only accepts
 * `payment_status === 'paid'` with a matching amount and currency.
 */

let client: Stripe | null = null;

export const isStripeConfigured = (): boolean => Boolean(config.stripe.secret_key);

const getClient = (): Stripe => {
  if (!config.stripe.secret_key) {
    throw new AppError(503, 'Stripe is not configured on this server');
  }
  // Created lazily so a missing key never breaks boot or unrelated routes.
  client ??= new Stripe(config.stripe.secret_key);
  return client;
};

/** BDT is a two-decimal currency, so Stripe expects the amount in poisha. */
export const toMinorUnits = (amount: number): number => Math.round(amount * 100);

type TStripeErrorLike = { type?: string; code?: string; statusCode?: number; message?: string };

/** Maps SDK errors onto AppErrors so they reach the client as clean JSON. */
const call = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;

    const stripeError = error as TStripeErrorLike;

    if (stripeError.code === 'resource_missing') {
      throw new AppError(404, 'Stripe checkout session not found');
    }

    throw new AppError(
      502,
      `Stripe request failed: ${stripeError.message ?? 'unknown error'}`
    );
  }
};

export type TCreateCheckoutInput = {
  paymentId: string;
  billId: string;
  amount: number;
  merchantInvoiceNumber: string;
  billingPeriod: string;
  meterNo: string;
  customerEmail: string;
};

export const createCheckoutSession = (
  input: TCreateCheckoutInput
): Promise<Stripe.Checkout.Session> =>
  call(() =>
    getClient().checkout.sessions.create({
      mode: 'payment',
      customer_email: input.customerEmail,
      client_reference_id: input.paymentId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'bdt',
            unit_amount: toMinorUnits(input.amount),
            product_data: {
              name: `Electricity bill ${input.billingPeriod}`,
              description: `Meter ${input.meterNo} - invoice ${input.merchantInvoiceNumber}`,
            },
          },
        },
      ],
      metadata: {
        paymentId: input.paymentId,
        billId: input.billId,
        merchantInvoiceNumber: input.merchantInvoiceNumber,
      },
      payment_intent_data: {
        metadata: { paymentId: input.paymentId, billId: input.billId },
      },
      // Our own payment id travels in both URLs, so the frontend never has to
      // trust (or even know) the Stripe session id.
      success_url: `${config.frontend_url}/payment/success?provider=stripe&paymentId=${input.paymentId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.frontend_url}/payment/cancel?provider=stripe&paymentId=${input.paymentId}`,
      // Stripe's minimum is 30 minutes; an abandoned session then expires
      // instead of lingering for the 24-hour default.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    })
  );

export const retrieveCheckoutSession = (
  sessionId: string
): Promise<Stripe.Checkout.Session> =>
  call(() => getClient().checkout.sessions.retrieve(sessionId));

/** Expires an open session so it can no longer be paid. */
export const expireCheckoutSession = (
  sessionId: string
): Promise<Stripe.Checkout.Session> =>
  call(() => getClient().checkout.sessions.expire(sessionId));

/** Verifies the Stripe-Signature header against the raw request body. */
export const constructWebhookEvent = (
  rawBody: Buffer,
  signature: string | undefined
): Stripe.Event => {
  if (!config.stripe.webhook_secret) {
    throw new AppError(503, 'Stripe webhook is not configured on this server');
  }
  if (!signature) {
    throw new AppError(400, 'Missing Stripe-Signature header');
  }

  try {
    return getClient().webhooks.constructEvent(
      rawBody,
      signature,
      config.stripe.webhook_secret
    );
  } catch (error) {
    throw new AppError(
      400,
      `Invalid Stripe webhook signature: ${(error as Error).message}`
    );
  }
};

/** The PaymentIntent id, which becomes the payment's trxID. */
export const paymentIntentId = (session: Stripe.Checkout.Session): string | null => {
  const intent = session.payment_intent;
  if (!intent) return null;
  return typeof intent === 'string' ? intent : intent.id;
};

export type TCheckoutSession = Stripe.Checkout.Session;
export type TStripeEvent = Stripe.Event;
