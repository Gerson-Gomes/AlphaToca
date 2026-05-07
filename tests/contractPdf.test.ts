import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time, and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const OUTSIDER_ID = '99999999-9999-9999-9999-999999999999';
const CONTRACT_ID = '55555555-5555-5555-5555-555555555555';

const { mockGetContractDownloadContext } = vi.hoisted(() => ({
  mockGetContractDownloadContext: vi.fn(),
}));

// Header-driven auth switch (same pattern as contractByPropertyTenant.test.ts):
// different Authorization values bind to different localUser.ids so a single
// app instance exercises landlord / tenant / outsider / anonymous paths.
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
  };
});

import request from 'supertest';
import app from '../src/app';

// PDF magic bytes — every valid PDF starts with "%PDF-". Tests write a
// minimal payload with the right prefix so assertion `firstFour === '%PDF'`
// holds without having to ship an actual PDF fixture.
const PDF_PAYLOAD = Buffer.from(
  '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj<<>>endobj\ntrailer<<>>%%EOF',
  'latin1',
);

const UPLOADS_ROOT = path.resolve(__dirname, '../uploads');
let tmpContractDir: string | null = null;
let storedPdfRelativeUrl: string | null = null;
let storedPdfAbsolutePath: string | null = null;

beforeAll(async () => {
  // Write a real temp file under `uploads/` so sendFile can stream actual
  // bytes. The relative URL we store on the contract mirrors the shape
  // propertyImageStorageService produces: `/uploads/<contractId>/<file>.pdf`.
  const contractFolder = `contract-${CONTRACT_ID}`;
  tmpContractDir = path.join(UPLOADS_ROOT, contractFolder);
  await mkdir(tmpContractDir, { recursive: true });
  storedPdfAbsolutePath = path.join(tmpContractDir, 'signed.pdf');
  await writeFile(storedPdfAbsolutePath, PDF_PAYLOAD);
  storedPdfRelativeUrl = `/uploads/${contractFolder}/signed.pdf`;
});

afterAll(async () => {
  if (tmpContractDir) {
    await rm(tmpContractDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/contracts/:id/pdf — US-015', () => {
  it('landlord streams the stored PDF (200, application/pdf, magic bytes %PDF-)', async () => {
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      pdfUrl: storedPdfRelativeUrl,
    });

    const res = await request(app)
      .get(`/api/contracts/${CONTRACT_ID}/pdf`)
      .set('Authorization', 'Bearer landlord-owner')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    const body = res.body as Buffer;
    expect(body.slice(0, 4).toString('latin1')).toBe('%PDF');
    expect(mockGetContractDownloadContext).toHaveBeenCalledWith(CONTRACT_ID);
  });

  it('tenant streams the stored PDF (200)', async () => {
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      pdfUrl: storedPdfRelativeUrl,
    });

    const res = await request(app)
      .get(`/api/contracts/${CONTRACT_ID}/pdf`)
      .set('Authorization', 'Bearer the-tenant')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect((res.body as Buffer).slice(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('absolute https:// pdfUrl → 302 redirect with Location header pointing at the signed URL', async () => {
    const signedUrl =
      'https://storage.example.com/contracts/55555555.pdf?sig=abcd&expires=1234';
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      pdfUrl: signedUrl,
    });

    const res = await request(app)
      .get(`/api/contracts/${CONTRACT_ID}/pdf`)
      .set('Authorization', 'Bearer landlord-owner')
      .redirects(0); // do NOT follow; we want to observe the 302

    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe(signedUrl);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('returns 404 NOT_FOUND when the contract does not exist', async () => {
    mockGetContractDownloadContext.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/contracts/${randomUUID()}/pdf`)
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });

  it('returns 404 CONTRACT_PDF_NOT_AVAILABLE when pdfUrl is null', async () => {
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      pdfUrl: null,
    });

    const res = await request(app)
      .get(`/api/contracts/${CONTRACT_ID}/pdf`)
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'CONTRACT_PDF_NOT_AVAILABLE');
    expect(res.body.messages).toBeInstanceOf(Array);
  });

  it('returns 404 CONTRACT_PDF_NOT_AVAILABLE when pdfUrl points at a missing file on disk', async () => {
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      pdfUrl: '/uploads/does-not-exist/ghost.pdf',
    });

    const res = await request(app)
      .get(`/api/contracts/${CONTRACT_ID}/pdf`)
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'CONTRACT_PDF_NOT_AVAILABLE');
  });

  it('returns 403 FORBIDDEN for a caller who is neither landlord nor tenant', async () => {
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      pdfUrl: storedPdfRelativeUrl,
    });

    const res = await request(app)
      .get(`/api/contracts/${CONTRACT_ID}/pdf`)
      .set('Authorization', 'Bearer outsider');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
  });

  it('returns 401 UNAUTHORIZED when no Authorization header is sent and never touches the service', async () => {
    const res = await request(app).get(`/api/contracts/${CONTRACT_ID}/pdf`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockGetContractDownloadContext).not.toHaveBeenCalled();
  });

  it('refuses to serve paths that escape the uploads root (defense-in-depth)', async () => {
    mockGetContractDownloadContext.mockResolvedValue({
      id: CONTRACT_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      // Stored value tries to reach /etc/passwd via `..` traversal. The
      // controller normalizes the path and rejects anything outside
      // UPLOADS_ROOT with 404 CONTRACT_PDF_NOT_AVAILABLE.
      pdfUrl: '/uploads/../../etc/passwd',
    });

    const res = await request(app)
      .get(`/api/contracts/${CONTRACT_ID}/pdf`)
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'CONTRACT_PDF_NOT_AVAILABLE');
  });
});
