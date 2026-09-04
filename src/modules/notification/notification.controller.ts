import { Request, Response } from 'express';
import { currentUser, param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { NotificationService } from './notification.service';

const getMine = async (req: Request, res: Response): Promise<void> => {
  const { data, meta, unreadCount } = await NotificationService.getMine(
    currentUser(req).userId,
    req.query as Record<string, unknown>
  );

  sendResponse(res, {
    statusCode: 200,
    message: `Notifications retrieved successfully (${unreadCount} unread)`,
    meta,
    data,
  });
};

const markRead = async (req: Request, res: Response): Promise<void> => {
  const data = await NotificationService.markRead(
    param(req, 'id'),
    currentUser(req).userId
  );

  sendResponse(res, {
    statusCode: 200,
    message: data.alreadyRead
      ? 'Notification was already read'
      : 'Notification marked as read',
    data,
  });
};

const markAllRead = async (req: Request, res: Response): Promise<void> => {
  const data = await NotificationService.markAllRead(currentUser(req).userId);

  sendResponse(res, {
    statusCode: 200,
    message: 'All notifications marked as read',
    data,
  });
};

export const NotificationController = { getMine, markRead, markAllRead };
