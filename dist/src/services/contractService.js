"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractError = void 0;
exports.createContract = createContract;
exports.updateContractStatus = updateContractStatus;
exports.getContractById = getContractById;
exports.getContractDownloadContext = getContractDownloadContext;
exports.attachSignedPdfToContract = attachSignedPdfToContract;
exports.getActiveContractByPropertyAndTenant = getActiveContractByPropertyAndTenant;
exports.updateContractDocumentStatus = updateContractDocumentStatus;
exports.listLandlordTenants = listLandlordTenants;
exports.listTenantContracts = listTenantContracts;
exports.updatePaymentStatus = updatePaymentStatus;
const db_1 = __importDefault(require("../config/db"));
const client_1 = require("@prisma/client");
class ContractError extends Error {
    httpStatus;
    code;
    constructor(httpStatus, code, message) {
        super(message);
        this.httpStatus = httpStatus;
        this.code = code;
        this.name = 'ContractError';
    }
}
exports.ContractError = ContractError;
const TERMINAL_CONTRACT_STATUSES = ['TERMINATED', 'COMPLETED'];
async function createContract(data) {
    const { propertyId, tenantId, landlordId, startDate, endDate, monthlyRent, dueDay, pdfUrl } = data;
    return db_1.default.$transaction(async (tx) => {
        // Guard: exactly one ACTIVE contract allowed per property. Any attempt to
        // activate a second rental while one is already active throws 409 and
        // rolls back the entire transaction — no partial Property.status write.
        const existingActive = await tx.contract.findFirst({
            where: { propertyId, status: 'ACTIVE' },
            select: { id: true },
        });
        if (existingActive) {
            throw new ContractError(409, 'RENTAL_PROCESS_ALREADY_ACTIVE', 'There is already an active rental for this property');
        }
        // 1. Create the contract
        const contract = await tx.contract.create({
            data: {
                propertyId,
                tenantId,
                landlordId,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                monthlyRent: new client_1.Prisma.Decimal(monthlyRent),
                dueDay,
                pdfUrl,
                status: 'ACTIVE',
            },
            include: {
                property: true,
                tenant: true,
                landlord: true,
            }
        });
        // 2. Update property status to RENTED in the SAME transaction — if this
        // tx is rolled back by a later failure, Property.status reverts too.
        await tx.property.update({
            where: { id: propertyId },
            data: { status: 'RENTED' }
        });
        return contract;
    });
}
async function updateContractStatus(id, newStatus) {
    return db_1.default.$transaction(async (tx) => {
        const existing = await tx.contract.findUnique({
            where: { id },
            select: { id: true, status: true, propertyId: true },
        });
        if (!existing) {
            throw new ContractError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
        }
        if (existing.status === newStatus) {
            // no-op status write — still return the contract shape so the controller
            // can respond 200 consistently.
            return tx.contract.findUnique({
                where: { id },
                include: { property: true, tenant: true, landlord: true },
            });
        }
        // Re-activation guard: if transitioning FROM a terminal status BACK TO
        // ACTIVE, enforce the same single-active-contract invariant.
        if (newStatus === 'ACTIVE' && existing.status !== 'ACTIVE') {
            const otherActive = await tx.contract.findFirst({
                where: {
                    propertyId: existing.propertyId,
                    status: 'ACTIVE',
                    id: { not: id },
                },
                select: { id: true },
            });
            if (otherActive) {
                throw new ContractError(409, 'RENTAL_PROCESS_ALREADY_ACTIVE', 'There is already an active rental for this property');
            }
        }
        const updated = await tx.contract.update({
            where: { id },
            data: { status: newStatus },
            include: { property: true, tenant: true, landlord: true },
        });
        // Auto-transition Property.status in the same transaction:
        //   ACTIVE        → terminal (TERMINATED/COMPLETED): property → AVAILABLE
        //   non-ACTIVE    → ACTIVE                          : property → RENTED
        if (existing.status === 'ACTIVE' && TERMINAL_CONTRACT_STATUSES.includes(newStatus)) {
            await tx.property.update({
                where: { id: existing.propertyId },
                data: { status: 'AVAILABLE' },
            });
        }
        else if (newStatus === 'ACTIVE' && existing.status !== 'ACTIVE') {
            await tx.property.update({
                where: { id: existing.propertyId },
                data: { status: 'RENTED' },
            });
        }
        return updated;
    });
}
async function getContractById(id) {
    return db_1.default.contract.findUnique({
        where: { id },
        include: {
            property: true,
            tenant: { select: { id: true, name: true, email: true, phoneNumber: true } },
            landlord: { select: { id: true, name: true, email: true, phoneNumber: true } },
            payments: true,
        }
    });
}
async function getContractDownloadContext(id) {
    return db_1.default.contract.findUnique({
        where: { id },
        select: { id: true, landlordId: true, tenantId: true, pdfUrl: true },
    });
}
// Anexa um PDF assinado ao contrato: grava `pdfUrl` (URL relativa do
// storage) + `signedAt` (timestamp do servidor) em uma transação. O
// ownership check (só o landlord pode subir) é feito no controller — o
// serviço assume o caminho feliz. O caller é responsável por compensar o
// arquivo em disco se esta chamada falhar (outer try/catch pattern,
// mesmo padrão do `createProperty` + multer photos).
async function attachSignedPdfToContract(id, pdfUrl) {
    const signedAt = new Date();
    const updated = await db_1.default.contract.update({
        where: { id },
        data: { pdfUrl, signedAt },
        select: { pdfUrl: true, signedAt: true },
    });
    return {
        pdfUrl: updated.pdfUrl,
        signedAt: updated.signedAt.toISOString(),
    };
}
// Retorna o contrato ACTIVE entre um (propertyId, tenantId). O filtro por
// status='ACTIVE' é intencional: a descrição do PRD US-014 diz "fetch the
// active contract", então contratos TERMINATED/COMPLETED não satisfazem a
// chamada mesmo quando os ids batem. `null` quando não há nenhum ACTIVE —
// traduz-se em 404 CONTRACT_NOT_FOUND no controller.
//
// `landlordId` volta no retorno apenas para o controller poder reaproveitar
// na checagem de autorização (landlord-or-tenant), mas o frontend recebe a
// projeção sem esse campo via `toContractByPropertyTenantResponse`.
async function getActiveContractByPropertyAndTenant(propertyId, tenantId) {
    const row = await db_1.default.contract.findFirst({
        where: { propertyId, tenantId, status: 'ACTIVE' },
        select: {
            id: true,
            propertyId: true,
            tenantId: true,
            landlordId: true,
            startDate: true,
            endDate: true,
            monthlyRent: true,
            pdfUrl: true,
            signedAt: true,
            documentStatus: true,
        },
        orderBy: { createdAt: 'desc' },
    });
    if (!row)
        return null;
    return {
        id: row.id,
        propertyId: row.propertyId,
        tenantId: row.tenantId,
        landlordId: row.landlordId,
        startDate: row.startDate.toISOString(),
        endDate: row.endDate.toISOString(),
        monthlyRent: Number(row.monthlyRent),
        pdfUrl: row.pdfUrl ?? null,
        signedAt: row.signedAt ? row.signedAt.toISOString() : null,
        documentStatus: row.documentStatus,
    };
}
// Erros do service de documentStatus (LL-016). 404 quando o contract
// não existe; 403 quando o caller não é o landlord do contrato. O
// controller mapeia para { status, code, messages } via ContractError.
async function updateContractDocumentStatus(id, callerId, newStatus) {
    const existing = await db_1.default.contract.findUnique({
        where: { id },
        select: { id: true, landlordId: true },
    });
    if (!existing) {
        throw new ContractError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
    }
    if (existing.landlordId !== callerId) {
        throw new ContractError(403, 'FORBIDDEN', 'Only the contract landlord can change its document status.');
    }
    const updated = await db_1.default.contract.update({
        where: { id },
        data: { documentStatus: newStatus },
        select: { id: true, documentStatus: true },
    });
    return updated;
}
async function listLandlordTenants(landlordId) {
    // Finds users who have active contracts with this landlord
    const tenants = await db_1.default.user.findMany({
        where: {
            contractsAsTenant: {
                some: {
                    landlordId,
                    status: 'ACTIVE'
                }
            }
        },
        include: {
            contractsAsTenant: {
                where: { landlordId, status: 'ACTIVE' },
                include: {
                    property: {
                        select: { id: true, title: true, address: true }
                    }
                }
            }
        }
    });
    return tenants.map(t => ({
        id: t.id,
        name: t.name,
        email: t.email,
        phoneNumber: t.phoneNumber,
        activeContracts: t.contractsAsTenant
    }));
}
async function listTenantContracts(tenantId) {
    return db_1.default.contract.findMany({
        where: { tenantId },
        include: {
            property: { select: { id: true, title: true, address: true } },
            landlord: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });
}
async function updatePaymentStatus(paymentId, status, paidDate) {
    return db_1.default.tenantPayment.update({
        where: { id: paymentId },
        data: {
            status,
            paidDate: paidDate ? new Date(paidDate) : undefined
        }
    });
}
