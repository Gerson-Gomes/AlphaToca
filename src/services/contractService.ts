import prisma from '../config/db';
import { Prisma, ContractStatus, ContractDocumentStatus, PaymentStatus } from '@prisma/client';

export class ContractError extends Error {
  constructor(
    public httpStatus: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ContractError';
  }
}

const TERMINAL_CONTRACT_STATUSES: ContractStatus[] = ['TERMINATED', 'COMPLETED'];

export async function createContract(data: any) {
  const { propertyId, tenantId, landlordId, startDate, endDate, monthlyRent, dueDay, pdfUrl } = data;

  return prisma.$transaction(async (tx) => {
    // Guard: exactly one ACTIVE contract allowed per property. Any attempt to
    // activate a second rental while one is already active throws 409 and
    // rolls back the entire transaction — no partial Property.status write.
    const existingActive = await tx.contract.findFirst({
      where: { propertyId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (existingActive) {
      throw new ContractError(
        409,
        'RENTAL_PROCESS_ALREADY_ACTIVE',
        'There is already an active rental for this property',
      );
    }

    // 1. Create the contract
    const contract = await tx.contract.create({
      data: {
        propertyId,
        tenantId,
        landlordId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        monthlyRent: new Prisma.Decimal(monthlyRent),
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

export async function updateContractStatus(id: string, newStatus: ContractStatus) {
  return prisma.$transaction(async (tx) => {
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
        throw new ContractError(
          409,
          'RENTAL_PROCESS_ALREADY_ACTIVE',
          'There is already an active rental for this property',
        );
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
    } else if (newStatus === 'ACTIVE' && existing.status !== 'ACTIVE') {
      await tx.property.update({
        where: { id: existing.propertyId },
        data: { status: 'RENTED' },
      });
    }

    return updated;
  });
}

export async function getContractById(id: string) {
  return prisma.contract.findUnique({
    where: { id },
    include: {
      property: true,
      tenant: { select: { id: true, name: true, email: true, phoneNumber: true } },
      landlord: { select: { id: true, name: true, email: true, phoneNumber: true } },
      payments: true,
    }
  });
}

// Subset do Contract projetado para o download do PDF (US-015). Carrega
// apenas o necessário para autorização (landlordId/tenantId) + pdfUrl. Evita
// puxar property/tenant/landlord completos e payments — o endpoint só
// precisa saber "quem pode" e "onde está o arquivo".
export type ContractDownloadContext = {
  id: string;
  landlordId: string;
  tenantId: string;
  pdfUrl: string | null;
};

export async function getContractDownloadContext(
  id: string,
): Promise<ContractDownloadContext | null> {
  return prisma.contract.findUnique({
    where: { id },
    select: { id: true, landlordId: true, tenantId: true, pdfUrl: true },
  });
}

// Resposta pública do PUT /api/contracts/:id/signed-document (US-016).
// Projetada pra casar com a leitura subsequente do GET /api/contracts
// (US-014) — frontend atualiza o card só reaproveitando esses campos.
export type SignedDocumentView = {
  pdfUrl: string;
  signedAt: string;
};

// Anexa um PDF assinado ao contrato: grava `pdfUrl` (URL relativa do
// storage) + `signedAt` (timestamp do servidor) em uma transação. O
// ownership check (só o landlord pode subir) é feito no controller — o
// serviço assume o caminho feliz. O caller é responsável por compensar o
// arquivo em disco se esta chamada falhar (outer try/catch pattern,
// mesmo padrão do `createProperty` + multer photos).
export async function attachSignedPdfToContract(
  id: string,
  pdfUrl: string,
): Promise<SignedDocumentView> {
  const signedAt = new Date();
  const updated = await prisma.contract.update({
    where: { id },
    data: { pdfUrl, signedAt },
    select: { pdfUrl: true, signedAt: true },
  });
  return {
    pdfUrl: updated.pdfUrl!,
    signedAt: updated.signedAt!.toISOString(),
  };
}

// Forma do Contract exposta por GET /api/contracts?propertyId=&tenantId=
// (US-014). É um subset deliberado do modelo: omite landlordId/dueDay/status/
// createdAt/updatedAt para alinhar com o contrato PRD exato. `pdfUrl` e
// `signedAt` são `null` quando ainda não há PDF assinado anexado (nunca
// `undefined` — o contrato HTTP promete presença dos campos).
export type ContractByPropertyTenantView = {
  id: string;
  propertyId: string;
  tenantId: string;
  landlordId: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  pdfUrl: string | null;
  signedAt: string | null;
  documentStatus: ContractDocumentStatus;
};

// Retorna o contrato ACTIVE entre um (propertyId, tenantId). O filtro por
// status='ACTIVE' é intencional: a descrição do PRD US-014 diz "fetch the
// active contract", então contratos TERMINATED/COMPLETED não satisfazem a
// chamada mesmo quando os ids batem. `null` quando não há nenhum ACTIVE —
// traduz-se em 404 CONTRACT_NOT_FOUND no controller.
//
// `landlordId` volta no retorno apenas para o controller poder reaproveitar
// na checagem de autorização (landlord-or-tenant), mas o frontend recebe a
// projeção sem esse campo via `toContractByPropertyTenantResponse`.
export async function getActiveContractByPropertyAndTenant(
  propertyId: string,
  tenantId: string,
): Promise<ContractByPropertyTenantView | null> {
  const row = await prisma.contract.findFirst({
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

  if (!row) return null;

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
export async function updateContractDocumentStatus(
  id: string,
  callerId: string,
  newStatus: ContractDocumentStatus,
): Promise<{ id: string; documentStatus: ContractDocumentStatus }> {
  const existing = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, landlordId: true },
  });
  if (!existing) {
    throw new ContractError(404, 'CONTRACT_NOT_FOUND', 'Contract not found');
  }
  if (existing.landlordId !== callerId) {
    throw new ContractError(
      403,
      'FORBIDDEN',
      'Only the contract landlord can change its document status.',
    );
  }

  const updated = await prisma.contract.update({
    where: { id },
    data: { documentStatus: newStatus },
    select: { id: true, documentStatus: true },
  });
  return updated;
}

export async function listLandlordTenants(landlordId: string) {
  // Finds users who have active contracts with this landlord
  const tenants = await prisma.user.findMany({
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

export async function listTenantContracts(tenantId: string) {
  return prisma.contract.findMany({
    where: { tenantId },
    include: {
      property: { select: { id: true, title: true, address: true } },
      landlord: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function updatePaymentStatus(paymentId: string, status: PaymentStatus, paidDate?: string) {
  return prisma.tenantPayment.update({
    where: { id: paymentId },
    data: {
      status,
      paidDate: paidDate ? new Date(paidDate) : undefined
    }
  });
}
