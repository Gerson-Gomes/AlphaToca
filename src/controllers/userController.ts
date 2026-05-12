import { Request, Response, NextFunction } from 'express';
import { userService } from '../services/userService';
import { UserSchema, UserUpdateSchema, UserUpdateMeSchema } from '../utils/userValidation';

export const userController = {
  /**
   * GET /api/users/me
   * Returns the authenticated user's profile from the local database.
   */
  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = (req as any).localUser;

      if (!localUser) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Authenticated user profile not found in database.' }]
        });
      }

      return res.status(200).json(localUser);
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/users/me/fcm-token
   * Updates the authenticated user's FCM token.
   */
  async updateFcmToken(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = (req as any).localUser;

      if (!localUser) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Authenticated user profile not found in database.' }]
        });
      }

      const { fcmToken } = req.body;

      if (!fcmToken || typeof fcmToken !== 'string') {
        return res.status(400).json({
          status: 400,
          code: 'BAD_REQUEST',
          messages: [{ message: 'fcmToken is required and must be a string.' }]
        });
      }

      const updatedUser = await userService.updateUser(localUser.id, { fcmToken });
      return res.status(200).json(updatedUser);
    } catch (error) {
      next(error);
    }
  },

  async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = (req as any).localUser;

      if (!localUser) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Authenticated user profile not found in database.' }]
        });
      }

      const validatedData = UserUpdateMeSchema.parse(req.body);

      if (Object.keys(validatedData).length === 0) {
        return res.status(400).json({
          status: 400,
          code: 'BAD_REQUEST',
          messages: [{ message: 'No valid fields to update. Provide phoneNumber and/or role.' }]
        });
      }

      const updatedUser = await userService.updateUser(localUser.id, validatedData);
      return res.status(200).json(updatedUser);
    } catch (error) {
      next(error);
    }
  },

  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const users = await userService.getAllUsers();
      return res.status(200).json(users);
    } catch (error) {
      next(error);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = await userService.getUserById(id);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const validatedData = UserSchema.parse(req.body);
      const newUser = await userService.createUser(validatedData);
      return res.status(201).json(newUser);
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const validatedData = UserUpdateSchema.parse(req.body);
      const user = await userService.updateUser(id, validatedData);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const success = await userService.deleteUser(id);

      if (!success) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status, suspendedUntil, reason } = req.body;

      if (!status || !['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) {
        return res.status(400).json({
          status: 400,
          code: 'VALIDATION_ERROR',
          messages: [{ message: 'status must be ACTIVE, SUSPENDED, or BANNED' }],
        });
      }

      const user = await userService.updateUserStatus(id, { status, suspendedUntil, reason });

      if (!user) {
        return res.status(404).json({
          status: 404,
          code: 'USER_NOT_FOUND',
          messages: [{ message: `User ${id} not found.` }],
        });
      }

      return res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  }
};
