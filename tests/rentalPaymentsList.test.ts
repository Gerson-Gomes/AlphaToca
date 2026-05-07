import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time, and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_LANDLORD_ID = '33333333-3333-3333-3333-333333333333';
const TENANT_ID = '44444444-4444-4444-4444-444444444444';

const {
  mockGetPropertyById,
  mockListByTenant,
} = vi.hoisted(() => ({
  mockGetPropertyById: vi.fn(),
  mockListByTenant: vi.fn(),
}));

// Header-driven owner/intruder switch (same pattern as rentalPaymentCurrent).
vi.mock('../src/middlewares/authMiddleware', () => ({
  validateAuthConfig: () => {},
  checkJwt: (req: any, res: any, next: any) => {
    const header = req.headers.authorization;
    if (header === 'Bearer landlord-owner' || header === 'Bearer landlord-intruder') {
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
    const isOwner = req.auth?.payload?.uid === 'Bearer landlord-owner';
    req.localUser = {
      id: isOwner ? LANDLORD_ID : OTHER_LANDLORD_ID,
      firebaseUid: req.auth?.payload?.uid ?? 'unknown',
      name: isOwner ? 'Owner Landlord' : 'Intruder Landlord',
      email: isOwner ? 'owner@demo.com' : 'intruder@demo.com',
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

vi.mock('../src/services/rentalPaymentService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    rentalPaymentService: {
      ...actual.rentalPaymentService,
      listByTenant: mockListByTenant,
    },
  };
});

import request from 'supertest';
import app from '../src/app';

function seedProperty(overrides: Partial<any> = {}) {
  return {
    id: randomUUID(),
    landlordId: LANDLORD_ID,
    title: 'Seeded',
    description: 'A property seeded for rental-payment list tests.',
    price: 3200,
    address: 'Rua Teste, 123',
    status: 'AVAILABLE',
    images: [],
    currentTenant: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/properties/:propertyId/payments — LL-009', () => {
  it('happy path: returns the service-provided array and forwards (propertyId, tenantId)', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    const payload = [
      {
        period: '2026-05',
        amount: 3200,
        status: 'PAID',
        paidAt: new Date('2026-05-05T10:00:00Z').toISOString(),
      },
      {
        period: '2026-04',
        amount: 3200,
        status: 'PAID',
        paidAt: new Date('2026-04-04T09:00:00Z').toISOString(),
      },
      {
        period: '2026-03',
        amount: 3200,
        status: 'AWAITING',
        paidAt: null,
      },
    ];
    mockListByTenant.mockResolvedValue(payload);

    const res = await request(app)
      .get(`/api/properties/${property.id}/payments`)
      .query({ tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    expect(mockListByTenant).toHaveBeenCalledWith(property.id, TENANT_ID);
  });

  it('returns an empty array when the service finds no payments', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockListByTenant.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/properties/${property.id}/payments`)
      .query({ tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockListByTenant).toHaveBeenCalledWith(property.id, TENANT_ID);
  });

  it('returns 400 VALIDATION_ERROR when tenantId is missing from the query', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);

    const res = await request(app)
      .get(`/api/properties/${property.id}/payments`)
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockListByTenant).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when tenantId is not a UUID', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);

    const res = await request(app)
      .get(`/api/properties/${property.id}/payments`)
      .query({ tenantId: 'not-a-uuid' })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockListByTenant).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when propertyId path param is not a UUID', async () => {
    const res = await request(app)
      .get('/api/properties/not-a-uuid/payments')
      .query({ tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockListByTenant).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHORIZED when no Authorization header is sent', async () => {
    const res = await request(app)
      .get(`/api/properties/${randomUUID()}/payments`)
      .query({ tenantId: TENANT_ID });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockListByTenant).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the property does not exist', async () => {
    mockGetPropertyById.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/properties/${randomUUID()}/payments`)
      .query({ tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockListByTenant).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND to a non-owner when the property does not exist (no existence leak)', async () => {
    // Both owner and intruder see the same 404 on a missing id — otherwise the
    // 403 vs 404 divergence lets callers probe "is this uuid a real property I
    // don't own". Same invariant as LL-008's ownership-gated analytics endpoint.
    mockGetPropertyById.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/properties/${randomUUID()}/payments`)
      .query({ tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-intruder');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockListByTenant).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN when a non-owner attempts to read an existing property', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);

    const res = await request(app)
      .get(`/api/properties/${property.id}/payments`)
      .query({ tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-intruder');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockListByTenant).not.toHaveBeenCalled();
  });
});
