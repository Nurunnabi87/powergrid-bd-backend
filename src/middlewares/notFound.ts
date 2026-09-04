import { NextFunction, Request, Response } from 'express';

const notFound = (req: Request, res: Response, _next: NextFunction): void => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    errors: [],
    errorDetails: [],
  });
};

export default notFound;
