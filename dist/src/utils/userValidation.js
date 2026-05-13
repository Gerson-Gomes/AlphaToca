"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserUpdateMeSchema = exports.UserUpdateSchema = exports.UserSchema = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
exports.UserSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, "Name must be at least 2 characters"),
    email: zod_1.z.string().email("Invalid email format"),
    phoneNumber: zod_1.z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format"),
    role: zod_1.z.nativeEnum(client_1.Role).default(client_1.Role.TENANT),
    fcmToken: zod_1.z.string().optional(),
});
exports.UserUpdateSchema = exports.UserSchema.partial();
exports.UserUpdateMeSchema = zod_1.z.object({
    phoneNumber: zod_1.z.string()
        .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format")
        .optional(),
    role: zod_1.z.enum(['TENANT', 'LANDLORD']).optional(),
});
