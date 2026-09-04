import { ErrorRequestHandler } from 'express';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { ZodError } from 'zod';
import config from '../config';
import AppError from '../errors/AppError';
import { Prisma } from '../generated/prisma/client';

type TErrorDetail = { field: string; message: string };

type TDriverCause = {
  table?: string;
  constraint?: { index?: string; fields?: string[] };
};

/**
 * Prisma 7 talks to Postgres through a driver adapter, which no longer
 * fills in the old `meta.target` array. The offending column now has to be
 * recovered from the driver's constraint payload - typically an index name
 * shaped `<table>_<field>_key`. Falls back to `meta.target` so the handler
 * still works if a future release restores it.
 */
const constraintFields = (meta: Record<string, unknown> | undefined): string[] => {
  const legacyTarget = meta?.target;
  if (Array.isArray(legacyTarget)) return legacyTarget as string[];
  if (typeof legacyTarget === 'string') return [legacyTarget];

  const cause = (meta?.driverAdapterError as { cause?: TDriverCause } | undefined)
    ?.cause;

  if (cause?.constraint?.fields?.length) return cause.constraint.fields;

  const index = cause?.constraint?.index;
  if (!index) return [];

  // "distribution_zones_code_key" -> "code"
  const withoutSuffix = index.replace(/_(key|pkey|fkey|idx)$/, '');
  const withoutTable = cause.table
    ? withoutSuffix.replace(new RegExp(`^${cause.table}_`), '')
    : withoutSuffix;

  return withoutTable ? withoutTable.split('_') : [];
};

const globalErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let statusCode = 500;
  let message = 'Something went wrong';
  let errorDetails: TErrorDetail[] = [];

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    errorDetails = err.issues.map((issue) => ({
      // Drop the leading "body"/"query"/"params" segment so the client sees
      // the field name it actually sent.
      field: issue.path.slice(1).join('.') || String(issue.path[0] ?? ''),
      message: issue.message,
    }));
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      statusCode = 409;
      const fields = constraintFields(err.meta);
      const target = fields.join(', ');
      message = target
        ? `A record with this ${target} already exists`
        : 'Duplicate value violates a unique constraint';
      errorDetails = fields.map((field) => ({ field, message }));
    } else if (err.code === 'P2025') {
      statusCode = 404;
      message = (err.meta?.cause as string) ?? 'Record not found';
    } else if (err.code === 'P2003') {
      statusCode = 400;
      const field = (err.meta?.field_name as string) ?? 'relation';
      message = `Invalid reference: related record for "${field}" does not exist`;
      errorDetails = [{ field, message }];
    } else {
      statusCode = 400;
      message = `Database error (${err.code})`;
    }
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    message = 'Invalid data supplied to the database query';
  } else if (err instanceof TokenExpiredError) {
    statusCode = 401;
    message = 'Your session has expired. Please log in again';
  } else if (err instanceof JsonWebTokenError) {
    statusCode = 401;
    message = 'Invalid authentication token';
  } else if (err instanceof SyntaxError && 'body' in err) {
    statusCode = 400;
    message = 'Malformed JSON in request body';
  } else if (err instanceof Error) {
    message = err.message || message;
  }

  res.status(statusCode).json({
    success: false,
    message,
    // The assignment spec names this array `errors`; the house style uses
    // `errorDetails`. Both are emitted so either contract is satisfied.
    errors: errorDetails,
    errorDetails,
    ...(config.node_env === 'development' && {
      stack: err instanceof Error ? err.stack : undefined,
    }),
  });
};

export default globalErrorHandler;
