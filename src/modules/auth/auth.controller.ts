import { Request, Response } from 'express';
import AppError from '../../errors/AppError';
import sendResponse from '../../shared/sendResponse';
import { AuthService } from './auth.service';

const register = async (req: Request, res: Response): Promise<void> => {
  const result = await AuthService.register(req.body);

  sendResponse(res, {
    statusCode: 201,
    message: 'Registration successful',
    data: result,
  });
};

const login = async (req: Request, res: Response): Promise<void> => {
  const result = await AuthService.login(req.body);

  sendResponse(res, {
    statusCode: 200,
    message: 'Login successful',
    data: result,
  });
};

const googleLogin = async (req: Request, res: Response): Promise<void> => {
  const result = await AuthService.googleLogin(req.body.idToken);

  sendResponse(res, {
    statusCode: 200,
    message: 'Google login successful',
    data: result,
  });
};

const refreshToken = async (req: Request, res: Response): Promise<void> => {
  const result = await AuthService.refreshToken(req.body.refreshToken);

  sendResponse(res, {
    statusCode: 200,
    message: 'Access token refreshed',
    data: result,
  });
};

const logout = async (req: Request, res: Response): Promise<void> => {
  const result = await AuthService.logout(req.body.refreshToken);

  sendResponse(res, {
    statusCode: 200,
    message: result.revoked
      ? 'Logged out successfully'
      : 'Token was already revoked or expired',
    data: result,
  });
};

const changePassword = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Authentication required');

  const result = await AuthService.changePassword(req.user.userId, req.body);

  sendResponse(res, {
    statusCode: 200,
    message: 'Password changed successfully. Please log in again',
    data: result,
  });
};

export const AuthController = {
  register,
  login,
  googleLogin,
  refreshToken,
  logout,
  changePassword,
};
