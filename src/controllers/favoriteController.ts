import { Request, Response, NextFunction } from 'express';
import { addFavorite, removeFavorite, listUserFavorites, isPropertyFavorited } from '../services/favoriteService';
import { z } from 'zod';

const favoriteSchema = z.object({
  propertyId: z.string().uuid()
});

export const favoriteController = {
  async add(req: Request, res: Response, next: NextFunction) {
    try {
      const { propertyId } = favoriteSchema.parse(req.body);
      const userId = (req as any).user.id; // From authMiddleware
      const favorite = await addFavorite(userId, propertyId);
      return res.status(201).json(favorite);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const propertyId = req.params.propertyId;
      const userId = (req as any).user.id;
      await removeFavorite(userId, propertyId);
      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.id;
      const favorites = await listUserFavorites(userId);
      return res.status(200).json(favorites);
    } catch (err) {
      next(err);
    }
  },

  async check(req: Request, res: Response, next: NextFunction) {
    try {
      const propertyId = req.params.propertyId;
      const userId = (req as any).user.id;
      const favorited = await isPropertyFavorited(userId, propertyId);
      return res.status(200).json({ favorited });
    } catch (err) {
      next(err);
    }
  }
};
