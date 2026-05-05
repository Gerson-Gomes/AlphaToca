import prisma from '../config/db';
import { Prisma, ContractStatus, PaymentStatus } from '@prisma/client';

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

export async function createContract(data: any) {
  const { propertyId, tenantId, landlordId, startDate, endDate, monthlyRent, dueDay, contractUrl } = data;

  return prisma.$transaction(async (tx) => {
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
        contractUrl,
        status: 'ACTIVE',
      },
      include: {
        property: true,
        tenant: true,
        landlord: true,
      }
    });

    // 2. Update property status to RENTED
    await tx.property.update({
      where: { id: propertyId },
      data: { status: 'RENTED' }
    });

    return contract;
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
