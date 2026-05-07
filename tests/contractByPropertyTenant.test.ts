import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time, and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const OUTSIDER_ID = '99999999-9999-9999-9999-999999999999';

const { mockGetPropertyById, mockGetActiveContract } = vi.hoisted(() => ({
  mockGetPropertyById: vi.fn(),
  mockGetActiveContract: vi.fn(),
}));

// Header-driven auth switch (same pattern as conversationResolve.test.ts):
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

vi.mock('../src/services/propertyService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    propertyService: {
      ...actual.propertyService,
      getPropertyById: mockGetPropertyById,
    },
  };
});

vi.mock('../src/services/contractService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getActiveContractByPropertyAndTenant: mockGetActiveContract,
  };
});

import request from 'supertest';
import app from '../src/app';

function seedProperty(overrides: Partial<any> = {}) {
  return {
    id: randomUUID(),
    landlordId: LANDLORD_ID,
    title: 'Seeded',
    description: 'A property seeded for contract-lookup tests.',
    price: 3200,
    address: 'Rua Teste, 123',
    status: 'AVAILABLE',
    images: [],
    currentTenant: null,
    ...overrides,
  };
}

function seedContractView(propertyId: string, overrides: Partial<any> = {}) {
  return {
    id: '55555555-5555-5555-5555-555555555555',
    propertyId,
    tenantId: TENANT_ID,
    landlordId: LANDLORD_ID,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2027-01-01T00:00:00.000Z',
    monthlyRent: 2500,
    pdfUrl: null,
    signedAt: null,
    documentStatus: 'PENDING_DOCUMENTS',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/contracts?propertyId=&tenantId= — US-014', () => {
  it('landlord owner of the property receives the projected contract (200, landlordId omitted)', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockGetActiveContract.mockResolvedValue(seedContractView(property.id));

    const res = await request(app)
      .get('/api/contracts')
      .query({ propertyId: property.id, tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: '55555555-5555-5555-5555-555555555555',
      propertyId: property.id,
      tenantId: TENANT_ID,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
      monthlyRent: 2500,
      pdfUrl: null,
      signedAt: null,
      documentStatus: 'PENDING_DOCUMENTS',
    });
    // PRD contract: landlordId is NOT part of the projection.
    expect(res.body).not.toHaveProperty('landlordId');
    // Optional fields come through as explicit null (not undefined).
    expect(res.body.pdfUrl).toBeNull();
    expect(res.body.signedAt).toBeNull();
    expect(mockGetActiveContract).toHaveBeenCalledWith(property.id, TENANT_ID);
  });

  it('tenant specified in query reads the contract (200)', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockGetActiveContract.mockResolvedValue(
      seedContractView(property.id, {
        pdfUrl: '/uploads/contracts/55555555.pdf',
        signedAt: '2026-04-15T12:00:00.000Z',
      }),
    );

    const res = await request(app)
      .get('/api/contracts')
      .query({ propertyId: property.id, tenantId: TENANT_ID })
      .set('Authorization', 'Bearer the-tenant');

    expect(res.status).toBe(200);
    expect(res.body.pdfUrl).toBe('/uploads/contracts/55555555.pdf');
    expect(res.body.signedAt).toBe('2026-04-15T12:00:00.000Z');
    expect(mockGetActiveContract).toHaveBeenCalledWith(property.id, TENANT_ID);
  });

  it('returns 404 CONTRACT_NOT_FOUND when no contract exists for the pair', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockGetActiveContract.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/contracts')
      .query({ propertyId: property.id, tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'CONTRACT_NOT_FOUND');
    expect(res.body).toHaveProperty('status', 404);
    expect(res.body.messages).toBeInstanceOf(Array);
  });

  it('third-party caller (neither landlord nor tenant) returns 403 FORBIDDEN', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);

    const res = await request(app)
      .get('/api/contracts')
      .query({ propertyId: property.id, tenantId: TENANT_ID })
      .set('Authorization', 'Bearer outsider');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockGetActiveContract).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHORIZED when no Authorization header is sent', async () => {
    const res = await request(app)
      .get('/api/contracts')
      .query({ propertyId: randomUUID(), tenantId: TENANT_ID });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockGetActiveContract).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for non-uuid propertyId', async () => {
    const res = await request(app)
      .get('/api/contracts')
      .query({ propertyId: 'not-a-uuid', tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockGetActiveContract).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for non-uuid tenantId', async () => {
    const res = await request(app)
      .get('/api/contracts')
      .query({ propertyId: randomUUID(), tenantId: 'not-a-uuid' })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockGetActiveContract).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when either query param is missing', async () => {
    const res = await request(app)
      .get('/api/contracts')
      .query({ propertyId: randomUUID() })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockGetActiveContract).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the property does not exist', async () => {
    mockGetPropertyById.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/contracts')
      .query({ propertyId: randomUUID(), tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockGetActiveContract).not.toHaveBeenCalled();
  });
});
