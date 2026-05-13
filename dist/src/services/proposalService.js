"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposalError = void 0;
exports.createProposal = createProposal;
exports.listProposals = listProposals;
exports.getProposalById = getProposalById;
exports.updateProposalStatus = updateProposalStatus;
const db_1 = __importDefault(require("../config/db"));
const client_1 = require("@prisma/client");
class ProposalError extends Error {
    httpStatus;
    code;
    constructor(httpStatus, code, message) {
        super(message);
        this.httpStatus = httpStatus;
        this.code = code;
        this.name = 'ProposalError';
    }
}
exports.ProposalError = ProposalError;
async function createProposal(input) {
    // Check if property exists
    const property = await db_1.default.property.findUnique({
        where: { id: input.propertyId }
    });
    if (!property) {
        throw new ProposalError(404, 'PROPERTY_NOT_FOUND', 'Property not found');
    }
    if (property.status === 'RENTED') {
        throw new ProposalError(400, 'PROPERTY_UNAVAILABLE', 'Property is already rented');
    }
    // Check if tenant exists
    const tenant = await db_1.default.user.findUnique({
        where: { id: input.tenantId }
    });
    if (!tenant) {
        throw new ProposalError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }
    // Check if tenant already has an active proposal for this property
    const existingProposal = await db_1.default.proposal.findFirst({
        where: {
            tenantId: input.tenantId,
            propertyId: input.propertyId,
            status: {
                in: ['PENDING', 'COUNTER_OFFER']
            }
        }
    });
    if (existingProposal) {
        throw new ProposalError(409, 'PROPOSAL_EXISTS', 'Tenant already has an active proposal for this property');
    }
    const proposal = await db_1.default.proposal.create({
        data: {
            propertyId: input.propertyId,
            tenantId: input.tenantId,
            proposedPrice: new client_1.Prisma.Decimal(input.proposedPrice),
            message: input.message,
            status: 'PENDING'
        },
        include: {
            tenant: { select: { id: true, name: true, email: true, phoneNumber: true } },
            property: { select: { id: true, title: true, price: true } }
        }
    });
    // Update property status to NEGOTIATING if it was AVAILABLE
    if (property.status === 'AVAILABLE') {
        await db_1.default.property.update({
            where: { id: input.propertyId },
            data: { status: 'NEGOTIATING' }
        });
    }
    return proposal;
}
async function listProposals(filters) {
    const where = {};
    if (filters.tenantId) {
        where.tenantId = filters.tenantId;
    }
    if (filters.propertyId) {
        where.propertyId = filters.propertyId;
    }
    if (filters.landlordId) {
        where.property = {
            landlordId: filters.landlordId
        };
    }
    return db_1.default.proposal.findMany({
        where,
        include: {
            tenant: { select: { id: true, name: true, email: true, phoneNumber: true } },
            property: { select: { id: true, title: true, price: true, landlordId: true } }
        },
        orderBy: { createdAt: 'desc' }
    });
}
async function getProposalById(id) {
    return db_1.default.proposal.findUnique({
        where: { id },
        include: {
            tenant: { select: { id: true, name: true, email: true, phoneNumber: true } },
            property: { select: { id: true, title: true, price: true, landlordId: true } }
        }
    });
}
async function updateProposalStatus(id, status) {
    const proposal = await db_1.default.proposal.findUnique({
        where: { id }
    });
    if (!proposal)
        return null;
    const updatedProposal = await db_1.default.proposal.update({
        where: { id },
        data: { status },
        include: {
            tenant: { select: { id: true, name: true, email: true, phoneNumber: true } },
            property: { select: { id: true, title: true, price: true } }
        }
    });
    // If accepted, update property to RENTED and reject all other pending/counter proposals
    if (status === 'ACCEPTED') {
        await db_1.default.property.update({
            where: { id: proposal.propertyId },
            data: { status: 'RENTED' }
        });
        await db_1.default.proposal.updateMany({
            where: {
                propertyId: proposal.propertyId,
                id: { not: id },
                status: { in: ['PENDING', 'COUNTER_OFFER'] }
            },
            data: { status: 'REJECTED' }
        });
    }
    return updatedProposal;
}
