import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time, and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const INTRUDER_ID = '99999999-9999-9999-9999-999999999999';
const CONTRACT_ID = '55555555-5555-5555-5555-555555555555';

const { prismaContractFindUnique, prismaContractUpdate } = vi.hoisted(() => ({
  prismaContractFindUnique: vi.fn(),
  prismaContractUpdate: vi.fn(),
}));

// Header-driven auth switch — same pattern used across the LL epic (see
// contractByPropertyTenant.test.ts / rentalPaymentCurrent.test.ts). Different
// Bearer values bind different localUser ids so a single app instance
// exercises landlord / intruder / anonymous paths from one describe block.
vi.mock('../src/middlewares/authMiddleware', () => ({
  validateAuthConfig: () => {},
  checkJwt: (req: any, res: any, next: any) => {
    const header = req.headers.authorization;
    if (header === 'Bearer landlord-owner' || header === 'Bearer intruder') {
      req.auth = { payload: { uid: header } };
      return next();
    }
    return res.status(401).json({
      status: 401,
      code: 'UNAUTHORIZED',
      messages: [{ message: 'Missing or invalid Authorization header.' }],
    });
  },
  authSyncMiddleware: (req: any, _res: any, next: any) => {
    const uid = req.auth?.payload?.uid;
    const id = uid === 'Bearer landlord-owner' ? LANDLORD_ID : INTRUDER_ID;
    req.localUser = {
      id,
      firebaseUid: uid ?? 'unknown',
      name: 'Test User',
      email: 'test@demo.com',
      phoneNumber: '+5511999999000',
      role: 'LANDLORD',
      fcmToken: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/config/db', () => ({
  default: {
    contract: {
      findUnique: prismaContractFindUnique,
      update: prismaContractUpdate,
    },
  },
}));

import request from 'supertest';
import app from '../src/app';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/contracts/:id/document-status — LL-016', () => {
  it('landlord owner flips PENDING_DOCUMENTS → AWAITING_SIGNATURE (200 + { id, documentStatus })', async () => {
    prismaContractFindUnique.mockResolvedValue({ id: CONTRACT_ID, landlordId: LANDLORD_ID });
    prismaContractUpdate.mockResolvedValue({ id: CONTRACT_ID, documentStatus: 'AWAITING_SIGNATURE' });

    const res = await request(app)
      .patch(`/api/contracts/${CONTRACT_ID}/document-status`)
      .set('Authorization', 'Bearer landlord-owner')
      .send({ documentStatus: 'AWAITING_SIGNATURE' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: CONTRACT_ID, documentStatus: 'AWAITING_SIGNATURE' });
    expect(prismaContractFindUnique).toHaveBeenCalledWith({
      where: { id: CONTRACT_ID },
      select: { id: true, landlordId: true },
    });
    expect(prismaContractUpdate).toHaveBeenCalledWith({
      where: { id: CONTRACT_ID },
      data: { documentStatus: 'AWAITING_SIGNATURE' },
      select: { id: true, documentStatus: true },
    });
  });

  it('accepts APPROVED (terminal happy path)', async () => {
    prismaContractFindUnique.mockResolvedValue({ id: CONTRACT_ID, landlordId: LANDLORD_ID });
    prismaContractUpdate.mockResolvedValue({ id: CONTRACT_ID, documentStatus: 'APPROVED' });

    const res = await request(app)
      .patch(`/api/contracts/${CONTRACT_ID}/document-status`)
      .set('Authorization', 'Bearer landlord-owner')
      .send({ documentStatus: 'APPROVED' });

    expect(res.status).toBe(200);
    expect(res.body.documentStatus).toBe('APPROVED');
  });

  it('returns 403 FORBIDDEN when caller is authenticated but not the landlord', async () => {
    prismaContractFindUnique.mockResolvedValue({ id: CONTRACT_ID, landlordId: LANDLORD_ID });

    const res = await request(app)
      .patch(`/api/contracts/${CONTRACT_ID}/document-status`)
      .set('Authorization', 'Bearer intruder')
      .send({ documentStatus: 'APPROVED' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(prismaContractUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 CONTRACT_NOT_FOUND when the contract does not exist', async () => {
    prismaContractFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/contracts/${CONTRACT_ID}/document-status`)
      .set('Authorization', 'Bearer landlord-owner')
      .send({ documentStatus: 'APPROVED' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'CONTRACT_NOT_FOUND');
    expect(prismaContractUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for unknown documentStatus value', async () => {
    const res = await request(app)
      .patch(`/api/contracts/${CONTRACT_ID}/document-status`)
      .set('Authorization', 'Bearer landlord-owner')
      .send({ documentStatus: 'NOT_A_REAL_VALUE' });

    expect(res.status).toBe(400);
    expect(prismaContractFindUnique).not.toHaveBeenCalled();
    expect(prismaContractUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when documentStatus field is missing', async () => {
    const res = await request(app)
      .patch(`/api/contracts/${CONTRACT_ID}/document-status`)
      .set('Authorization', 'Bearer landlord-owner')
      .send({});

    expect(res.status).toBe(400);
    expect(prismaContractFindUnique).not.toHaveBeenCalled();
    expect(prismaContractUpdate).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHORIZED when Authorization header is missing', async () => {
    const res = await request(app)
      .patch(`/api/contracts/${CONTRACT_ID}/document-status`)
      .send({ documentStatus: 'APPROVED' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(prismaContractFindUnique).not.toHaveBeenCalled();
  });
});

describe('contractService.updateContractDocumentStatus — LL-016', () => {
  it('reads the contract with the narrow auth-check select (id + landlordId only)', async () => {
    prismaContractFindUnique.mockResolvedValue({ id: CONTRACT_ID, landlordId: LANDLORD_ID });
    prismaContractUpdate.mockResolvedValue({ id: CONTRACT_ID, documentStatus: 'APPROVED' });

    const { updateContractDocumentStatus } = await import('../src/services/contractService');
    await updateContractDocumentStatus(CONTRACT_ID, LANDLORD_ID, 'APPROVED' as any);

    expect(prismaContractFindUnique).toHaveBeenCalledWith({
      where: { id: CONTRACT_ID },
      select: { id: true, landlordId: true },
    });
  });

  it('throws ContractError(404) when contract missing — does NOT issue an update', async () => {
    prismaContractFindUnique.mockResolvedValue(null);

    const { updateContractDocumentStatus, ContractError } = await import(
      '../src/services/contractService'
    );
    await expect(
      updateContractDocumentStatus(CONTRACT_ID, LANDLORD_ID, 'APPROVED' as any),
    ).rejects.toBeInstanceOf(ContractError);
    expect(prismaContractUpdate).not.toHaveBeenCalled();
  });

  it('throws ContractError(403) when caller is not the landlord — does NOT issue an update', async () => {
    prismaContractFindUnique.mockResolvedValue({ id: CONTRACT_ID, landlordId: LANDLORD_ID });

    const { updateContractDocumentStatus, ContractError } = await import(
      '../src/services/contractService'
    );
    await expect(
      updateContractDocumentStatus(CONTRACT_ID, INTRUDER_ID, 'APPROVED' as any),
    ).rejects.toBeInstanceOf(ContractError);
    expect(prismaContractUpdate).not.toHaveBeenCalled();
  });

  it('persists the new documentStatus and returns the narrow view { id, documentStatus }', async () => {
    prismaContractFindUnique.mockResolvedValue({ id: CONTRACT_ID, landlordId: LANDLORD_ID });
    prismaContractUpdate.mockResolvedValue({ id: CONTRACT_ID, documentStatus: 'AWAITING_SIGNATURE' });

    const { updateContractDocumentStatus } = await import('../src/services/contractService');
    const result = await updateContractDocumentStatus(
      CONTRACT_ID,
      LANDLORD_ID,
      'AWAITING_SIGNATURE' as any,
    );

    expect(result).toEqual({ id: CONTRACT_ID, documentStatus: 'AWAITING_SIGNATURE' });
    expect(prismaContractUpdate).toHaveBeenCalledWith({
      where: { id: CONTRACT_ID },
      data: { documentStatus: 'AWAITING_SIGNATURE' },
      select: { id: true, documentStatus: true },
    });
  });
});

describe('Contract.documentStatus default + backfill (schema contract — LL-016)', () => {
  // The migration is the single source of truth for both the DEFAULT
  // (PENDING_DOCUMENTS for new rows) and the BACKFILL (APPROVED where
  // signed_at IS NOT NULL). We read the migration SQL directly and assert
  // both clauses exist — this locks the migration body against accidental
  // edits without needing a live Postgres to exercise the backfill.
  it('migration SQL declares default=PENDING_DOCUMENTS and APPROVED backfill for signed contracts', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const migrationPath = path.resolve(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20260508010000_add_contract_document_status',
      'migration.sql',
    );
    const sql = await fs.readFile(migrationPath, 'utf-8');

    expect(sql).toContain(
      `CREATE TYPE "ContractDocumentStatus" AS ENUM ('PENDING_DOCUMENTS', 'AWAITING_SIGNATURE', 'APPROVED')`,
    );
    expect(sql).toMatch(
      /ALTER TABLE "contracts" ADD COLUMN\s+"document_status" "ContractDocumentStatus" NOT NULL DEFAULT 'PENDING_DOCUMENTS'/,
    );
    expect(sql).toContain(
      `UPDATE "contracts" SET "document_status" = 'APPROVED' WHERE "signed_at" IS NOT NULL`,
    );
  });

  it('ContractDocumentStatus enum values exported by the generated Prisma client', async () => {
    const { ContractDocumentStatus } = await import('@prisma/client');
    expect(ContractDocumentStatus).toEqual({
      PENDING_DOCUMENTS: 'PENDING_DOCUMENTS',
      AWAITING_SIGNATURE: 'AWAITING_SIGNATURE',
      APPROVED: 'APPROVED',
    });
  });
});
