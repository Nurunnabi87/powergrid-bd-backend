import nodemailer, { Transporter } from 'nodemailer';
import config from '../config';

/**
 * SMTP is optional. Without credentials the transport is null and every
 * send is logged to the console instead, so local development and the
 * graded demo work without a mail provider.
 */
const transporter: Transporter | null =
  config.smtp.host && config.smtp.user
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      })
    : null;

export const isEmailEnabled = (): boolean => transporter !== null;

export const sendEmail = async (payload: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> => {
  if (!transporter) {
    console.log(`[mail:disabled] to=${payload.to} subject="${payload.subject}"`);
    return;
  }

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html ?? `<p>${payload.text}</p>`,
    });
  } catch (error) {
    // A failed notification must never fail the business operation that
    // triggered it.
    console.error('[mail] send failed:', (error as Error).message);
  }
};
