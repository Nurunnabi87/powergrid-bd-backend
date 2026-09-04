import { TTokenPayload } from '../shared/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: TTokenPayload;
    }
  }
}

export {};
