import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import express from 'express';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time, and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const AUTHED_VIEWER_ID = '55555555-5555-5555-5555-555555555555';

const { mockGetPropertyById, mockRecord } = vi.hoisted(() => ({
  mockGetPropertyById: vi.fn(),
  mockRecord: vi.fn(),
}));

vi.mock('../src/middlewares/authMiddleware', () => ({
  validateAuthConfig: () => {},
  checkJwt: (_req: any, res: any, _next: any) =>
    res.status(401).json({
      status: 401,
      code: 'UNAUTHORIZED',
      messages: [{ message: 'Missing or invalid Authorization header.' }],
    }),
  authSyncMiddleware: (_req: any, _res: any, next: any) => next(),
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

vi.mock('../src/services/contactClickEventService', () => ({
  contactClickEventService: {
    record: mockRecord,
  },
}));

import request from 'supertest';
import app from '../src/app';
import propertyRoutes from '../src/routes/propertyRoutes';

function seedProperty(overrides: Partial<any> = {}) {
  return {
    id: randomUUID(),
    landlordId: '22222222-2222-2222-2222-222222222222',
    title: 'Seeded',
    description: 'A property seeded for contact-click tests.',
    price: 3200,
    address: 'Rua Teste, 123',
    status: 'AVAILABLE',
    images: [],
    currentTenant: null,
    ...overrides,
  };
}

// Mini-app that pre-populates `req.localUser` before the real propertyRoutes
// router runs. Used to exercise the "authenticated click" branch of the
// controller — the production route is PUBLIC (no authStack), so there is no
// path through app.ts that populates localUser on this endpoint. This mini
// app documents the controller's forwarding behavior for any future caller
// that DOES pre-populate localUser (optional-auth middleware, internal call).
function buildAuthedApp() {
  const authedApp = express();
  authedApp.use(express.json());
  authedApp.use('/api', (req, _res, next) => {
    (req as any).localUser = { id: AUTHED_VIEWER_ID };
    next();
  });
  authedApp.use('/api', propertyRoutes);
  return authedApp;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/properties/:id/contact-click — LL-007', () => {
  it('anonymous click: records the event with viewerId=null and returns 201 {}', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockRecord.mockResolvedValue(undefined);

    const res = await request(app).post(`/api/properties/${property.id}/contact-click`);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({});
    expect(mockGetPropertyById).toHaveBeenCalledWith(property.id);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledWith(property.id, null);
  });

  it('authenticated click: forwards req.localUser.id as viewerId', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockRecord.mockResolvedValue(undefined);

    const authedApp = buildAuthedApp();
    const res = await request(authedApp).post(`/api/properties/${property.id}/contact-click`);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({});
    expect(mockRecord).toHaveBeenCalledWith(property.id, AUTHED_VIEWER_ID);
  });

  it('returns 404 NOT_FOUND when the property does not exist (no event recorded)', async () => {
    mockGetPropertyById.mockResolvedValue(null);
    const missingId = randomUUID();

    const res = await request(app).post(`/api/properties/${missingId}/contact-click`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockGetPropertyById).toHaveBeenCalledWith(missingId);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when :id is not a UUID', async () => {
    const res = await request(app).post('/api/properties/not-a-uuid/contact-click');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockGetPropertyById).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('is PUBLIC — does NOT reject requests without an Authorization header (no 401)', async () => {
    const property = seedProperty();
    mockGetPropertyById.mockResolvedValue(property);
    mockRecord.mockResolvedValue(undefined);

    const res = await request(app).post(`/api/properties/${property.id}/contact-click`);

    // Would be 401 if the route were behind authStack. Confirms the route was
    // intentionally mounted without checkJwt/authSyncMiddleware.
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(201);
  });
});

