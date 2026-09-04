import { TTokenPayload } from '../shared/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TTokenPayload;
    }
  }
}

export {};
