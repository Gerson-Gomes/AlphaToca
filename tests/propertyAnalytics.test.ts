import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_LANDLORD_ID = '33333333-3333-3333-3333-333333333333';

const { mockGetPropertyById, mockGetAnalytics } = vi.hoisted(() => ({
  mockGetPropertyById: vi.fn(),
  mockGetAnalytics: vi.fn(),
}));

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

vi.mock('../src/services/propertyAnalyticsService', () => ({
  propertyAnalyticsService: { getAnalytics: mockGetAnalytics },
}));

vi.mock('../src/config/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import request from 'supertest';
import app from '../src/app';

function seedProperty(overrides: Partial<any> = {}) {
  return {
    id: randomUUID(),
    landlordId: LANDLORD_ID,
    title: 'Seeded',
    description: 'A property seeded for analytics tests.',
    price: 3200,
    address: 'Rua Teste, 123',
    status: 'AVAILABLE',
    images: [],
    currentTenant: null,
    ...overrides,
  };
}

function analyticsPayload(overrides: Partial<any> = {}) {
  return {
    views: 142,
    favorites: 23,
    proposalsTotal: 5,
    proposalsOpen: 2,
    visitsScheduled: 3,
    contactClicks: 18,
    dailyViews: [
      { date: '2026-05-06', count: 7 },
      { date: '2026-05-07', count: 3 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/properties/:id/analytics — LL-008', () => {
  it('200 with default window=30d when query is omitted', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockGetAnalytics.mockResolvedValue(analyticsPayload());

    const res = await request(app)
      .get(`/api/properties/${property.id}/analytics`)
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(analyticsPayload());
    expect(mockGetAnalytics).toHaveBeenCalledWith(property.id, '30d');
  });

  it('200 forwards each supported window value (30d/90d/1y)', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);

    for (const window of ['30d', '90d', '1y'] as const) {
      mockGetAnalytics.mockResolvedValueOnce(analyticsPayload({ views: 10 }));

      const res = await request(app)
        .get(`/api/properties/${property.id}/analytics?window=${window}`)
        .set('Authorization', 'Bearer landlord-owner');

      expect(res.status).toBe(200);
      expect(mockGetAnalytics).toHaveBeenLastCalledWith(property.id, window);
    }
  });

  it('response preserves the dailyViews zero-filled shape returned by the service', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    const payload = analyticsPayload({
      dailyViews: [
        { date: '2026-05-05', count: 0 },
        { date: '2026-05-06', count: 7 },
        { date: '2026-05-07', count: 0 },
      ],
    });
    mockGetAnalytics.mockResolvedValue(payload);

    const res = await request(app)
      .get(`/api/properties/${property.id}/analytics`)
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(200);
    expect(res.body.dailyViews).toEqual(payload.dailyViews);
    expect(res.body.dailyViews).toHaveLength(3);
  });

  it('400 VALIDATION_ERROR for malformed UUID on path', async () => {
    const res = await request(app)
      .get('/api/properties/not-a-uuid/analytics')
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_ERROR for a window value outside the enum', async () => {
    const res = await request(app)
      .get(`/api/properties/${randomUUID()}/analytics?window=7d`)
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });

  it('401 UNAUTHORIZED when no Authorization header is sent', async () => {
    const res = await request(app).get(`/api/properties/${randomUUID()}/analytics`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });

  it('404 NOT_FOUND when the property does not exist (before any 403 check)', async () => {
    mockGetPropertyById.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/properties/${randomUUID()}/analytics`)
      .set('Authorization', 'Bearer landlord-owner');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });

  it('404 NOT_FOUND is returned even for a non-owner when the property is missing (no existence leak)', async () => {
    // Guard: even the intruder gets NOT_FOUND, never "FORBIDDEN" on a missing
    // property — otherwise 403 would leak that the id corresponds to a real
    // property that the caller doesn't own.
    mockGetPropertyById.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/properties/${randomUUID()}/analytics`)
      .set('Authorization', 'Bearer landlord-intruder');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });

  it('403 FORBIDDEN when a non-owner reads a property that exists', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);

    const res = await request(app)
      .get(`/api/properties/${property.id}/analytics`)
      .set('Authorization', 'Bearer landlord-intruder');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });
});
