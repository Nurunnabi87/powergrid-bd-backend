import { Response } from 'express';

export type TMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type TResponsePayload<T> = {
  statusCode: number;
  message: string;
  meta?: TMeta;
  data?: T;
};

const sendResponse = <T>(res: Response, payload: TResponsePayload<T>): void => {
  res.status(payload.statusCode).json({
    success: true,
    message: payload.message,
    ...(payload.meta && { meta: payload.meta }),
    data: payload.data ?? null,
  });
};

export default sendResponse;
