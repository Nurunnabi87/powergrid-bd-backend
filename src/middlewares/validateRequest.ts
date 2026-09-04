import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';

/**
 * Validates body/params/query against a Zod schema. Parsed (and coerced)
 * values replace the originals so handlers receive typed data.
 *
 * Express 5 makes `req.query` a getter-only property, so the parsed query
 * is stashed on `res.locals.query` instead of being reassigned.
 */
const validateRequest =
  (schema: ZodType) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = (await schema.parseAsync({
      body: req.body,
      params: req.params,
      query: req.query,
    })) as {
      body?: unknown;
      params?: unknown;
      query?: Record<string, unknown>;
    };

    if (parsed && typeof parsed === 'object') {
      if ('body' in parsed) req.body = parsed.body;
      if ('query' in parsed) res.locals.query = parsed.query;
    }

    next();
  };

export default validateRequest;
