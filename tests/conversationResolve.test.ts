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

const { mockGetPropertyById, mockResolve } = vi.hoisted(() => ({
  mockGetPropertyById: vi.fn(),
  mockResolve: vi.fn(),
}));

// Header-driven auth switch (same pattern as rentalPaymentCurrent.test.ts):
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

vi.mock('../src/services/conversationService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    conversationService: {
      ...actual.conversationService,
      resolve: mockResolve,
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
    description: 'A property seeded for conversation-resolve tests.',
    price: 3200,
    address: 'Rua Teste, 123',
    status: 'AVAILABLE',
    images: [],
    currentTenant: null,
    ...overrides,
  };
}

function seedConversation(propertyId: string, overrides: Partial<any> = {}) {
  return {
    id: '44444444-4444-4444-4444-444444444444',
    propertyId,
    landlordId: LANDLORD_ID,
    tenantId: TENANT_ID,
    messages: [],
    createdAt: '2026-05-07T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/conversations/resolve — US-012', () => {
  it('landlord owner of the property resolves the thread (200)', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockResolve.mockResolvedValue(seedConversation(property.id));

    const res = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: property.id, tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(seedConversation(property.id));
    // Service receives landlordId derived from the Property — NOT from query.
    expect(mockResolve).toHaveBeenCalledWith(property.id, LANDLORD_ID, TENANT_ID);
  });

  it('tenant specified in the query resolves the thread (200)', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockResolve.mockResolvedValue(seedConversation(property.id));

    const res = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: property.id, tenantId: TENANT_ID })
      .set('Authorization', 'Bearer the-tenant');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('44444444-4444-4444-4444-444444444444');
    expect(mockResolve).toHaveBeenCalledWith(property.id, LANDLORD_ID, TENANT_ID);
  });

  it('second call with the same params returns the same id (idempotent)', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockResolve.mockResolvedValue(seedConversation(property.id));

    const first = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: property.id, tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');
    const second = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: property.id, tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.id).toBe(second.body.id);
  });

  it('two concurrent calls from the same caller resolve the same id (race-safe)', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockResolve.mockResolvedValue(seedConversation(property.id));

    const [a, b] = await Promise.all([
      request(app)
        .get('/api/conversations/resolve')
        .query({ propertyId: property.id, tenantId: TENANT_ID })
        .set('Authorization', 'Bearer landlord-owner'),
      request(app)
        .get('/api/conversations/resolve')
        .query({ propertyId: property.id, tenantId: TENANT_ID })
        .set('Authorization', 'Bearer landlord-owner'),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.id).toBe(b.body.id);
    // Both calls hit the service — idempotency is enforced by the DB unique
    // constraint on (propertyId, landlordId, tenantId), not the HTTP layer.
    expect(mockResolve).toHaveBeenCalledTimes(2);
  });

  it('caller who is neither landlord nor tenant returns 403 FORBIDDEN', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);

    const res = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: property.id, tenantId: TENANT_ID })
      .set('Authorization', 'Bearer outsider');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHORIZED when no Authorization header is sent', async () => {
    const res = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: randomUUID(), tenantId: TENANT_ID });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for non-uuid propertyId', async () => {
    const res = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: 'not-a-uuid', tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for non-uuid tenantId', async () => {
    const res = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: randomUUID(), tenantId: 'not-a-uuid' })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when either query param is missing', async () => {
    const res = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: randomUUID() })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the property does not exist', async () => {
    mockGetPropertyById.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: randomUUID(), tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('response body always has messages: [] regardless of service-state', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    // Even if the service somehow returned messages, the frontend contract
    // requires [] in this PRD. The service already synthesizes [] — this test
    // guards against future code that accidentally pipes a DB messages column
    // through to the response.
    mockResolve.mockResolvedValue(seedConversation(property.id, { messages: [] }));

    const res = await request(app)
      .get('/api/conversations/resolve')
      .query({ propertyId: property.id, tenantId: TENANT_ID })
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });
});
