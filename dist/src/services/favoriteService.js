"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addFavorite = addFavorite;
exports.removeFavorite = removeFavorite;
exports.listUserFavorites = listUserFavorites;
exports.isPropertyFavorited = isPropertyFavorited;
const db_1 = __importDefault(require("../config/db"));
async function addFavorite(userId, propertyId) {
    return db_1.default.favorite.upsert({
        where: {
            favorites_user_property_key: {
                userId,
                propertyId
            }
        },
        update: {}, // Do nothing if already exists
        create: {
            userId,
            propertyId
        },
        include: {
            property: true
        }
    });
}
async function removeFavorite(userId, propertyId) {
    return db_1.default.favorite.delete({
        where: {
            favorites_user_property_key: {
                userId,
                propertyId
            }
        }
    });
}
async function listUserFavorites(userId) {
    return db_1.default.favorite.findMany({
        where: { userId },
        include: {
            property: {
                include: {
                    images: {
                        where: { isCover: true },
                        take: 1
                    }
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
}
async function isPropertyFavorited(userId, propertyId) {
    const favorite = await db_1.default.favorite.findUnique({
        where: {
            favorites_user_property_key: {
                userId,
                propertyId
            }
        }
    });
    return !!favorite;
}
