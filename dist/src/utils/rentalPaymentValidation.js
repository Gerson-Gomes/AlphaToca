"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPaymentsQuerySchema = exports.listPaymentsParamsSchema = exports.updateCurrentPaymentSchema = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
exports.updateCurrentPaymentSchema = zod_1.z.object({
    status: zod_1.z.nativeEnum(client_1.RentalPaymentStatus),
});
// LL-009 — GET /api/properties/:propertyId/payments?tenantId=<uuid>
// Ambos os UUIDs são obrigatórios (400 VALIDATION_ERROR). `propertyId` chega
// no path via `req.params`, `tenantId` na query string via `req.query`.
exports.listPaymentsParamsSchema = zod_1.z.object({
    propertyId: zod_1.z.string().uuid(),
});
exports.listPaymentsQuerySchema = zod_1.z.object({
    tenantId: zod_1.z.string().uuid(),
});
