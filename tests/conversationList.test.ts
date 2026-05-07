import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const LANDLORD_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_ID = '33333333-3333-3333-3333-333333333333';

const { mockList } = vi.hoisted(() => ({
  mockList: vi.fn(),
}));

// Header-driven auth switch (matches the conversationResolve.test.ts pattern):
// Bearer the-landlord -> LANDLORD_ID, Bearer the-tenant -> TENANT_ID,
// Bearer the-other -> OTHER_ID (a user without any conversations — used for the
// empty-list edge). Missing header -> 401 from the stubbed checkJwt.
vi.mock('../src/middlewares/authMiddleware', () => ({
  validateAuthConfig: () => {},
  checkJwt: (req: any, res: any, next: any) => {
    const header = req.headers.authorization;
    if (
      header === 'Bearer the-landlord' ||
      header === 'Bearer the-tenant' ||
      header === 'Bearer the-other'
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
    let id = OTHER_ID;
    let role = 'TENANT';
    if (uid === 'Bearer the-landlord') {
      id = LANDLORD_ID;
      role = 'LANDLORD';
    } else if (uid === 'Bearer the-tenant') {
      id = TENANT_ID;
      role = 'TENANT';
    }
    req.localUser = {
      id,
      firebaseUid: uid ?? 'unknown',
      name: 'Test User',
      email: 'test@demo.com',
      phoneNumber: '+5511999999000',
      role,
      fcmToken: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/services/conversationService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    conversationService: {
      ...actual.conversationService,
      list: mockList,
    },
  };
});

import request from 'supertest';
import app from '../src/app';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/conversations — LL-011 (list)', () => {
  it('200: landlord sees tenants as counterparts; service receives (userId, unreadOnly=false) by default', async () => {
    const summaries = [
      {
        id: 'c-1',
        counterpartName: 'Maria Silva',
        counterpartAvatarUrl: null,
        lastMessage: 'Bom dia',
        lastMessageAt: '2026-05-07T12:00:00.000Z',
        unread: true,
        linkedPropertyId: 'p-1',
        linkedTenantId: TENANT_ID,
      },
      {
        id: 'c-2',
        counterpartName: 'José Santos',
        counterpartAvatarUrl: null,
        lastMessage: null,
        lastMessageAt: '2026-05-06T08:00:00.000Z',
        unread: false,
        linkedPropertyId: 'p-2',
        linkedTenantId: 'other-tenant',
      },
    ];
    mockList.mockResolvedValue(summaries);

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(summaries);
    expect(mockList).toHaveBeenCalledWith(LANDLORD_ID, false);
  });

  it('200: tenant sees landlords as counterparts; linkedTenantId is always the tenantId of the thread', async () => {
    const summaries = [
      {
        id: 'c-1',
        counterpartName: 'João Locador',
        counterpartAvatarUrl: null,
        lastMessage: 'Podemos agendar visita?',
        lastMessageAt: '2026-05-07T15:00:00.000Z',
        unread: false,
        linkedPropertyId: 'p-1',
        linkedTenantId: TENANT_ID,
      },
    ];
    mockList.mockResolvedValue(summaries);

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', 'Bearer the-tenant');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(summaries);
    expect(mockList).toHaveBeenCalledWith(TENANT_ID, false);
  });

  it('200: unreadOnly=true is forwarded to the service as true', async () => {
    mockList.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/conversations')
      .query({ unreadOnly: 'true' })
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockList).toHaveBeenCalledWith(LANDLORD_ID, true);
  });

  it('200: unreadOnly=false explicitly forwards false (not undefined)', async () => {
    mockList.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/conversations')
      .query({ unreadOnly: 'false' })
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(LANDLORD_ID, false);
  });

  it('200: empty array for users with no conversations (edge case — user exists, no threads)', async () => {
    mockList.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', 'Bearer the-other');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockList).toHaveBeenCalledWith(OTHER_ID, false);
  });

  it('200: conversations with zero messages still appear with lastMessage=null and lastMessageAt=createdAt', async () => {
    const created = '2026-05-01T10:00:00.000Z';
    mockList.mockResolvedValue([
      {
        id: 'c-empty',
        counterpartName: 'Maria Silva',
        counterpartAvatarUrl: null,
        lastMessage: null,
        lastMessageAt: created,
        unread: false,
        linkedPropertyId: 'p-1',
        linkedTenantId: TENANT_ID,
      },
    ]);

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body[0].lastMessage).toBeNull();
    expect(res.body[0].lastMessageAt).toBe(created);
  });

  it('400: unreadOnly with an invalid string value is rejected by Zod', async () => {
    const res = await request(app)
      .get('/api/conversations')
      .query({ unreadOnly: '1' })
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('401: missing Authorization header is rejected before any service call', async () => {
    const res = await request(app).get('/api/conversations');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockList).not.toHaveBeenCalled();
  });
});
