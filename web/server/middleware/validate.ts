import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

export const validate =
  (schema: ZodSchema): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: result.error.format(),
      });
    }

    req.body = result.data;
    next();
  };
