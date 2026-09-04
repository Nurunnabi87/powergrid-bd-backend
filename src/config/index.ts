import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

/**
 * Reads a required environment variable, failing fast at boot rather than
 * surfacing an `undefined` deep inside a request handler.
 */
const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optional = (key: string, fallback = ''): string =>
  process.env[key] ?? fallback;

export default {
  node_env: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '5000')),
  api_base_url: optional('API_BASE_URL', 'http://localhost:5000'),
  frontend_url: optional('FRONTEND_URL', 'http://localhost:3000'),
  cors_origins: optional('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  database_url: required('DATABASE_URL'),

  jwt_access_secret: required('JWT_ACCESS_SECRET'),
  jwt_access_expires_in: optional('JWT_ACCESS_EXPIRES_IN', '1d'),
  jwt_refresh_secret: required('JWT_REFRESH_SECRET'),
  jwt_refresh_expires_in: optional('JWT_REFRESH_EXPIRES_IN', '30d'),
  bcrypt_salt_rounds: Number(optional('BCRYPT_SALT_ROUNDS', '12')),

  google_client_id: optional('GOOGLE_CLIENT_ID'),

  redis_url: optional('REDIS_URL'),

  bkash: {
    base_url: optional('BKASH_BASE_URL', 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'),
    app_key: optional('BKASH_APP_KEY'),
    app_secret: optional('BKASH_APP_SECRET'),
    username: optional('BKASH_USERNAME'),
    password: optional('BKASH_PASSWORD'),
    callback_url: optional(
      'BKASH_CALLBACK_URL',
      'http://localhost:5000/api/v1/payments/bkash/callback'
    ),
  },

  cloudinary: {
    cloud_name: optional('CLOUDINARY_CLOUD_NAME'),
    api_key: optional('CLOUDINARY_API_KEY'),
    api_secret: optional('CLOUDINARY_API_SECRET'),
  },

  smtp: {
    host: optional('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '587')),
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
    from: optional('EMAIL_FROM', 'PowerGrid BD <no-reply@powergrid.bd>'),
  },
};
