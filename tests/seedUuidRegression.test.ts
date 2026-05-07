import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  DEMO_LANDLORD_1_ID,
  DEMO_PROPERTY_SP_1_ID,
  DEMO_PROPERTY_RJ_1_ID,
} from '../prisma/demoIds';

// Firebase env vars must be present before importing app (validateAuthConfig runs at load).
// The mocked authMiddleware below no-ops validateAuthConfig, but importing ../src/app
// transitively pulls in src/config/firebase which only logs if vars are missing.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

// Fully replace authMiddleware so checkJwt/authSyncMiddleware bypass Firebase and
// synthesize a demo landlord localUser whose id is the canonical UUID constant.
// This proves the /users/me → /properties/search chain works end-to-end without
// requiring a real Firebase token or a live database.
const { mockSearchProperties } = vi.hoisted(() => ({
  mockSearchProperties: vi.fn(),
}));

vi.mock('../src/middlewares/authMiddleware', () => ({
  validateAuthConfig: () => {},
  checkJwt: (req: any, res: any, next: any) => {
    if (req.headers.authorization === 'Bearer valid-landlord-token') {
      req.auth = { payload: { uid: 'firebase-uid-demo-landlord-1' } };
      return next();
    }
    return res.status(401).json({
      status: 401,
      code: 'UNAUTHORIZED',
      messages: [{ message: 'Missing or invalid Authorization header.' }],
    });
  },
  authSyncMiddleware: (req: any, _res: any, next: any) => {
    req.localUser = {
      id: DEMO_LANDLORD_1_ID,
      firebaseUid: 'firebase-uid-demo-landlord-1',
      name: 'Demo Landlord',
      email: 'landlord1@demo.com',
      phoneNumber: '+5511999999001',
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
      searchProperties: mockSearchProperties,
    },
  };
});

import request from 'supertest';
import app from '../src/app';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchProperties.mockImplementation(async (params: any) => {
    if (params.landlordId === DEMO_LANDLORD_1_ID) {
      return {
        data: [
          { id: DEMO_PROPERTY_SP_1_ID, landlordId: DEMO_LANDLORD_1_ID, title: 'Demo SP 1' },
          { id: DEMO_PROPERTY_RJ_1_ID, landlordId: DEMO_LANDLORD_1_ID, title: 'Demo RJ 1' },
        ],
        meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
      };
    }
    return { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } };
  });
});

describe('Seed/Validator UUID regression — /users/me → /properties/search chain', () => {
  it('GET /api/users/me as demo landlord returns 200 with a UUID-shaped id', async () => {
    const response = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer valid-landlord-token');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id');
    expect(typeof response.body.id).toBe('string');
    expect(z.string().uuid().safeParse(response.body.id).success).toBe(true);
    expect(UUID_V4_REGEX.test(response.body.id)).toBe(true);
    expect(response.body.id).toBe(DEMO_LANDLORD_1_ID);
  });

  it('GET /api/properties/search?landlordId={id from /users/me} returns 200 with data.length >= 1', async () => {
    const me = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer valid-landlord-token');
    expect(me.status).toBe(200);
    const landlordId = me.body.id;

    const response = await request(app)
      .get('/api/properties/search')
      .query({ landlordId });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data');
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    expect(mockSearchProperties).toHaveBeenCalledWith(
      expect.objectContaining({ landlordId: DEMO_LANDLORD_1_ID }),
    );
  });

  it('GET /api/properties/search?landlordId=user-demo-landlord-1 (legacy id) returns 400 VALIDATION_ERROR', async () => {
    const response = await request(app)
      .get('/api/properties/search')
      .query({ landlordId: 'user-demo-landlord-1' });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockSearchProperties).not.toHaveBeenCalled();
  });
});
