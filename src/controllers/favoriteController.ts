import { Request, Response, NextFunction } from 'express';
import { addFavorite, removeFavorite, listUserFavorites, isPropertyFavorited } from '../services/favoriteService';
import { z } from 'zod';

const favoriteSchema = z.object({
  propertyId: z.string().uuid()
});

function getUserId(req: Request, res: Response): string | null {
  const localUser = (req as any).localUser;
  if (!localUser) {
    res.status(401).json({
      status: 401,
      code: 'UNAUTHORIZED',
      messages: [{ message: 'Authentication required.' }],
    });
    return null;
  }
  return localUser.id;
}

export const favoriteController = {
  async add(req: Request, res: Response, next: NextFunction) {
    try {
      const { propertyId } = favoriteSchema.parse(req.body);
      const userId = getUserId(req, res);
      if (!userId) return;
      const favorite = await addFavorite(userId, propertyId);
      return res.status(201).json(favorite);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const propertyId = req.params.propertyId;
      const userId = getUserId(req, res);
      if (!userId) return;
      await removeFavorite(userId, propertyId);
      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getUserId(req, res);
      if (!userId) return;
      const favorites = await listUserFavorites(userId);
      return res.status(200).json(favorites);
    } catch (err) {
      next(err);
    }
  },

  async check(req: Request, res: Response, next: NextFunction) {
    try {
      const propertyId = req.params.propertyId;
      const userId = getUserId(req, res);
      if (!userId) return;
      const favorited = await isPropertyFavorited(userId, propertyId);
      return res.status(200).json({ favorited });
    } catch (err) {
      next(err);
    }
  }
};
