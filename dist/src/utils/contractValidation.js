"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateContractDocumentStatusSchema = exports.getContractQuerySchema = exports.updatePaymentStatusSchema = exports.updateContractStatusSchema = exports.createContractSchema = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
exports.createContractSchema = zod_1.z.object({
    propertyId: zod_1.z.string().uuid(),
    tenantId: zod_1.z.string().uuid(),
    landlordId: zod_1.z.string().uuid(),
    startDate: zod_1.z.string().datetime(),
    endDate: zod_1.z.string().datetime(),
    monthlyRent: zod_1.z.number().positive(),
    dueDay: zod_1.z.number().int().min(1).max(31),
    pdfUrl: zod_1.z.string().url().optional(),
});
exports.updateContractStatusSchema = zod_1.z.object({
    status: zod_1.z.nativeEnum(client_1.ContractStatus),
});
exports.updatePaymentStatusSchema = zod_1.z.object({
    status: zod_1.z.nativeEnum(client_1.PaymentStatus),
    paidDate: zod_1.z.string().datetime().optional(),
});
// Query params para GET /api/contracts?propertyId=&tenantId= (US-014). Ambos
// obrigatórios e em formato UUID canônico — qualquer valor fora do formato
// resulta em 400 VALIDATION_ERROR antes de qualquer acesso ao banco.
exports.getContractQuerySchema = zod_1.z.object({
    propertyId: zod_1.z.string().uuid(),
    tenantId: zod_1.z.string().uuid(),
});
// Body do PATCH /api/contracts/:id/document-status (LL-016). O único campo
// é `documentStatus`, validado contra o enum Prisma — qualquer valor fora
// de PENDING_DOCUMENTS/AWAITING_SIGNATURE/APPROVED retorna 400 VALIDATION_ERROR
// sem tocar no banco.
exports.updateContractDocumentStatusSchema = zod_1.z.object({
    documentStatus: zod_1.z.nativeEnum(client_1.ContractDocumentStatus),
});
