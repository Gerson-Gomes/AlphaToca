import prisma from '../config/db';
import { Prisma, ProposalStatus } from '@prisma/client';

export class ProposalError extends Error {
  constructor(
    public httpStatus: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ProposalError';
  }
}

interface CreateProposalInput {
  propertyId: string;
  tenantId: string;
  proposedPrice: number;
  message?: string;
}

export async function createProposal(input: CreateProposalInput) {
  // Check if property exists
  const property = await prisma.property.findUnique({
    where: { id: input.propertyId }
  });

  if (!property) {
    throw new ProposalError(404, 'PROPERTY_NOT_FOUND', 'Property not found');
  }

  if (property.status === 'RENTED') {
    throw new ProposalError(400, 'PROPERTY_UNAVAILABLE', 'Property is already rented');
  }

  // Check if tenant exists
  const tenant = await prisma.user.findUnique({
    where: { id: input.tenantId }
  });

  if (!tenant) {
    throw new ProposalError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
  }

  // Check if tenant already has an active proposal for this property
  const existingProposal = await prisma.proposal.findFirst({
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

  const proposal = await prisma.proposal.create({
    data: {
      propertyId: input.propertyId,
      tenantId: input.tenantId,
      proposedPrice: new Prisma.Decimal(input.proposedPrice),
      message: input.message,
      status: 'PENDING'
    },
    include: {
      tenant: { select: { id: true, name: true, email: true, phoneNumber: true } },
      property: { select: { id: true, title: true, price: true } }
    }
  });

  // Update property status to IN_NEGOTIATION if it was AVAILABLE
  if (property.status === 'AVAILABLE') {
    await prisma.property.update({
      where: { id: input.propertyId },
      data: { status: 'IN_NEGOTIATION' }
    });
  }

  return proposal;
}

export async function listProposals(filters: { tenantId?: string; propertyId?: string; landlordId?: string }) {
  const where: Prisma.ProposalWhereInput = {};

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

  return prisma.proposal.findMany({
    where,
    include: {
      tenant: { select: { id: true, name: true, email: true, phoneNumber: true } },
      property: { select: { id: true, title: true, price: true, landlordId: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function getProposalById(id: string) {
  return prisma.proposal.findUnique({
    where: { id },
    include: {
      tenant: { select: { id: true, name: true, email: true, phoneNumber: true } },
      property: { select: { id: true, title: true, price: true, landlordId: true } }
    }
  });
}

export async function updateProposalStatus(id: string, status: ProposalStatus) {
  const proposal = await prisma.proposal.findUnique({
    where: { id }
  });

  if (!proposal) return null;

  const updatedProposal = await prisma.proposal.update({
    where: { id },
    data: { status },
    include: {
      tenant: { select: { id: true, name: true, email: true, phoneNumber: true } },
      property: { select: { id: true, title: true, price: true } }
    }
  });

  // If accepted, update property to RENTED and reject all other pending/counter proposals
  if (status === 'ACCEPTED') {
    await prisma.property.update({
      where: { id: proposal.propertyId },
      data: { status: 'RENTED' }
    });

    await prisma.proposal.updateMany({
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
