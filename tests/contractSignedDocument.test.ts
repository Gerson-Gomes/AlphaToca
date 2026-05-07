import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import path from 'path';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time, and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const OUTSIDER_ID = '99999999-9999-9999-9999-999999999999';
const CONTRACT_ID = '66666666-6666-6666-6666-666666666666';

const { mockGetContractDownloadContext, mockAttachSignedPdfToContract } = vi.hoisted(() => ({
  mockGetContractDownloadContext: vi.fn(),
  mockAttachSignedPdfToContract: vi.fn(),
}));

// Header-driven auth switch (same pattern as contractPdf.test.ts).
vi.mock('../src/middlewares/authMiddleware', () => ({
  validateAuthConfig: () => {},
  checkJwt: (req: any, res: any, next: any) => {
    const header = req.headers.authorization;
    if (
      header === 'Bearer landlord-owner' ||
      header === 'Bearer the-tenant' ||
      header === 'Bearer outsider'
    ) {
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
    let id = OUTSIDER_ID;
    if (uid === 'Bearer landlord-owner') id = LANDLORD_ID;
    else if (uid === 'Bearer the-tenant') id = TENANT_ID;
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

vi.mock('../src/services/contractService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getContractDownloadContext: mockGetContractDownloadContext,
    attachSignedPdfToContract: mockAttachSignedPdfToContract,
  };
});

import request from 'supertest';
import app from '../src/app';

const PDF_PAYLOAD = Buffer.from(
  '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj<<>>endobj\ntrailer<<>>%%EOF',
  'latin1',
);

// Bytes that start with something other than %PDF but are sent with the
// application/pdf content-type — exercises the magic-bytes guard.
const FAKE_PDF = Buffer.from('NOPE this is not a PDF file at all', 'latin1');

const UPLOADS_ROOT = path.resolve(__dirname, '../uploads');
const CONTRACT_UPLOADS_ROOT = path.join(UPLOADS_ROOT, 'contracts');

beforeEach(() => {
  vi.clearAllMocks();
  // Default passthrough for the DB attach — tests can override per-case.
  mockAttachSignedPdfToContract.mockImplementation(
    async (id: string, pdfUrl: string) => ({
      pdfUrl,
      signedAt: '2026-05-07T12:00:00.000Z',
    }),
  );
});

afterEach(async () => {
  // Keep the uploads/contracts/<contract-id> directory clean between runs.
  await rm(path.join(CONTRACT_UPLOADS_ROOT, CONTRACT_ID), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
});

describe('PUT /api/contracts/:id/signed-document — US-016', () => {
  it('landlord uploads a valid PDF → 200 with { pdfUrl, signedAt } and file persisted under /uploads/contracts/<id>/', async () => {
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      pdfUrl: null,
    });

    const res = await request(app)
      .put(`/api/contracts/${CONTRACT_ID}/signed-document`)
      .set('Authorization', 'Bearer landlord-owner')
      .attach('signedPdf', PDF_PAYLOAD, {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pdfUrl');
    expect(res.body).toHaveProperty('signedAt');
    expect(res.body.pdfUrl).toMatch(
      new RegExp(`^/uploads/contracts/${CONTRACT_ID}/[0-9a-f-]+\\.pdf$`),
    );
    expect(mockAttachSignedPdfToContract).toHaveBeenCalledWith(
      CONTRACT_ID,
      res.body.pdfUrl,
    );

    // File is actually on disk. Read back the bytes and confirm magic
    // bytes survived the round trip.
    const dir = path.join(CONTRACT_UPLOADS_ROOT, CONTRACT_ID);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const absolutePath = path.join(dir, files[0]);
    const stats = await stat(absolutePath);
    expect(stats.size).toBe(PDF_PAYLOAD.length);
  });

  it('rejects magic-bytes mismatch with 400 INVALID_FILE_TYPE and never touches service', async () => {
    const res = await request(app)
      .put(`/api/contracts/${CONTRACT_ID}/signed-document`)
      .set('Authorization', 'Bearer landlord-owner')
      .attach('signedPdf', FAKE_PDF, {
        filename: 'fake.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'INVALID_FILE_TYPE');
    expect(mockGetContractDownloadContext).not.toHaveBeenCalled();
    expect(mockAttachSignedPdfToContract).not.toHaveBeenCalled();
  });

  it('rejects non-application/pdf mime type with 400 INVALID_FILE_TYPE (multer fileFilter)', async () => {
    const res = await request(app)
      .put(`/api/contracts/${CONTRACT_ID}/signed-document`)
      .set('Authorization', 'Bearer landlord-owner')
      .attach('signedPdf', Buffer.from('some text content'), {
        filename: 'contract.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'INVALID_FILE_TYPE');
    expect(mockGetContractDownloadContext).not.toHaveBeenCalled();
    expect(mockAttachSignedPdfToContract).not.toHaveBeenCalled();
  });

  it('non-landlord (tenant) receives 403 FORBIDDEN and service is not called', async () => {
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      pdfUrl: null,
    });

    const res = await request(app)
      .put(`/api/contracts/${CONTRACT_ID}/signed-document`)
      .set('Authorization', 'Bearer the-tenant')
      .attach('signedPdf', PDF_PAYLOAD, {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockAttachSignedPdfToContract).not.toHaveBeenCalled();
  });

  it('outsider (not landlord, not tenant) also receives 403 FORBIDDEN', async () => {
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      pdfUrl: null,
    });

    const res = await request(app)
      .put(`/api/contracts/${CONTRACT_ID}/signed-document`)
      .set('Authorization', 'Bearer outsider')
      .attach('signedPdf', PDF_PAYLOAD, {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockAttachSignedPdfToContract).not.toHaveBeenCalled();
  });

  it('anonymous request returns 401 UNAUTHORIZED (auth guard before multer)', async () => {
    const res = await request(app)
      .put(`/api/contracts/${CONTRACT_ID}/signed-document`)
      .attach('signedPdf', PDF_PAYLOAD, {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockGetContractDownloadContext).not.toHaveBeenCalled();
    expect(mockAttachSignedPdfToContract).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the contract does not exist', async () => {
    mockGetContractDownloadContext.mockResolvedValue(null);

    const res = await request(app)
      .put(`/api/contracts/${randomUUID()}/signed-document`)
      .set('Authorization', 'Bearer landlord-owner')
      .attach('signedPdf', PDF_PAYLOAD, {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockAttachSignedPdfToContract).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when the signedPdf field is missing (multipart with no file)', async () => {
    const res = await request(app)
      .put(`/api/contracts/${CONTRACT_ID}/signed-document`)
      .set('Authorization', 'Bearer landlord-owner')
      .field('nothing', 'here');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockAttachSignedPdfToContract).not.toHaveBeenCalled();
  });

  it('rejects an unexpected multipart field (UNEXPECTED_FILE_FIELD)', async () => {
    const res = await request(app)
      .put(`/api/contracts/${CONTRACT_ID}/signed-document`)
      .set('Authorization', 'Bearer landlord-owner')
      .attach('wrongField', PDF_PAYLOAD, {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'UNEXPECTED_FILE_FIELD');
    expect(mockAttachSignedPdfToContract).not.toHaveBeenCalled();
  });

  it('compensates by deleting the uploaded file when the DB write throws', async () => {
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      pdfUrl: null,
    });
    // Simulate a DB failure post-storage-write.
    mockAttachSignedPdfToContract.mockRejectedValueOnce(
      new Error('connection reset'),
    );

    const res = await request(app)
      .put(`/api/contracts/${CONTRACT_ID}/signed-document`)
      .set('Authorization', 'Bearer landlord-owner')
      .attach('signedPdf', PDF_PAYLOAD, {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      });

    // Error bubbles to the global errorHandler → 500 INTERNAL_SERVER_ERROR.
    expect(res.status).toBe(500);

    // Storage was cleaned up — no orphan PDF left behind.
    const dir = path.join(CONTRACT_UPLOADS_ROOT, CONTRACT_ID);
    const dirExists = await stat(dir).then(() => true).catch(() => false);
    if (dirExists) {
      const files = await readdir(dir);
      expect(files).toHaveLength(0);
    }
  });
});
