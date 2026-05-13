"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProposalsQuerySchema = exports.updateProposalStatusSchema = exports.createProposalSchema = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
exports.createProposalSchema = zod_1.z.object({
    propertyId: zod_1.z.string().uuid(),
    tenantId: zod_1.z.string().uuid(),
    proposedPrice: zod_1.z.number().positive(),
    message: zod_1.z.string().optional(),
});
exports.updateProposalStatusSchema = zod_1.z.object({
    status: zod_1.z.nativeEnum(client_1.ProposalStatus),
});
exports.listProposalsQuerySchema = zod_1.z.object({
    tenantId: zod_1.z.string().uuid().optional(),
    propertyId: zod_1.z.string().uuid().optional(),
    landlordId: zod_1.z.string().uuid().optional(),
});
