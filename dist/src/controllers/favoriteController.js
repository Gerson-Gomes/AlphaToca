"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.favoriteController = void 0;
const favoriteService_1 = require("../services/favoriteService");
const zod_1 = require("zod");
const favoriteSchema = zod_1.z.object({
    propertyId: zod_1.z.string().uuid()
});
exports.favoriteController = {
    async add(req, res, next) {
        try {
            const { propertyId } = favoriteSchema.parse(req.body);
            const userId = req.localUser.id; // From authMiddleware
            const favorite = await (0, favoriteService_1.addFavorite)(userId, propertyId);
            return res.status(201).json(favorite);
        }
        catch (err) {
            next(err);
        }
    },
    async remove(req, res, next) {
        try {
            const propertyId = req.params.propertyId;
            const userId = req.localUser.id;
            await (0, favoriteService_1.removeFavorite)(userId, propertyId);
            return res.status(204).send();
        }
        catch (err) {
            next(err);
        }
    },
    async list(req, res, next) {
        try {
            const userId = req.localUser.id;
            const favorites = await (0, favoriteService_1.listUserFavorites)(userId);
            return res.status(200).json(favorites);
        }
        catch (err) {
            next(err);
        }
    },
    async check(req, res, next) {
        try {
            const propertyId = req.params.propertyId;
            const userId = req.localUser.id;
            const favorited = await (0, favoriteService_1.isPropertyFavorited)(userId, propertyId);
            return res.status(200).json({ favorited });
        }
        catch (err) {
            next(err);
        }
    }
};
