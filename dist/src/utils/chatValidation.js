"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSessionStatusSchema = exports.createSessionSchema = exports.sendMessageSchema = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
exports.sendMessageSchema = zod_1.z.object({
    sessionId: zod_1.z.string().uuid(),
    senderType: zod_1.z.nativeEnum(client_1.SenderType),
    content: zod_1.z.string().min(1),
    mediaUrl: zod_1.z.string().url().optional(),
});
exports.createSessionSchema = zod_1.z.object({
    tenantId: zod_1.z.string().uuid(),
});
exports.updateSessionStatusSchema = zod_1.z.object({
    status: zod_1.z.nativeEnum(client_1.ChatStatus),
});
