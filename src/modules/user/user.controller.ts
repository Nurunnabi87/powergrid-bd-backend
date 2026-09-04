import { Request, Response } from 'express';
import AppError from '../../errors/AppError';
import { clientIp } from '../../shared/auditLog';
import { uploadBuffer } from '../../shared/cloudinary';
import { currentUser } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { UserService } from './user.service';

const getMe = async (req: Request, res: Response): Promise<void> => {
  const data = await UserService.getMe(currentUser(req).userId);
  sendResponse(res, { statusCode: 200, message: 'Profile retrieved successfully', data });
};

const updateMe = async (req: Request, res: Response): Promise<void> => {
  const data = await UserService.updateMe(
    currentUser(req).userId,
    req.body,
    clientIp(req)
  );
  sendResponse(res, { statusCode: 200, message: 'Profile updated successfully', data });
};

const updateAvatar = async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    throw new AppError(400, 'An image file is required in the "avatar" field');
  }

  const url = await uploadBuffer(req.file.buffer, 'powergrid/avatars');
  const data = await UserService.updateAvatar(currentUser(req).userId, url);

  sendResponse(res, { statusCode: 200, message: 'Avatar updated successfully', data });
};

const getMyConnections = async (req: Request, res: Response): Promise<void> => {
  const data = await UserService.getMyConnections(currentUser(req).userId);
  sendResponse(res, {
    statusCode: 200,
    message: 'Connections retrieved successfully',
    data,
  });
};

export const UserController = { getMe, updateMe, updateAvatar, getMyConnections };
