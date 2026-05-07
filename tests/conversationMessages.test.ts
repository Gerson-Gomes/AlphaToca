import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const LANDLORD_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const OUTSIDER_ID = '33333333-3333-3333-3333-333333333333';

const { mockListMessages, mockFindUnique } = vi.hoisted(() => ({
  mockListMessages: vi.fn(),
  mockFindUnique: vi.fn(),
}));

// Header-driven auth switch: Bearer the-landlord -> LANDLORD_ID,
// Bearer the-tenant -> TENANT_ID, Bearer outsider -> OUTSIDER_ID, else 401.
vi.mock('../src/middlewares/authMiddleware', () => ({
  validateAuthConfig: () => {},
  checkJwt: (req: any, res: any, next: any) => {
    const header = req.headers.authorization;
    if (
      header === 'Bearer the-landlord' ||
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
    if (uid === 'Bearer the-landlord') id = LANDLORD_ID;
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

// Mock the prisma default-export used by the controller's auth-check lookup.
vi.mock('../src/config/db', () => ({
  default: {
    conversation: {
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock('../src/services/conversationService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    conversationService: {
      ...actual.conversationService,
      listMessages: mockListMessages,
    },
  };
});

import request from 'supertest';
import app from '../src/app';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/conversations/:id/messages — LL-012', () => {
  it('200: landlord fetches latest page; default limit=50; no before', async () => {
    const convId = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    const messages = [
      {
        id: 'm-1',
        authorId: TENANT_ID,
        content: 'Oi',
        createdAt: '2026-05-07T10:00:00.000Z',
        readAt: '2026-05-07T10:05:00.000Z',
      },
      {
        id: 'm-2',
        authorId: LANDLORD_ID,
        content: 'Olá',
        createdAt: '2026-05-07T10:10:00.000Z',
        readAt: null,
      },
    ];
    mockListMessages.mockResolvedValue({ messages, markedReadIds: ['m-1'] });

    const res = await request(app)
      .get(`/api/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(messages);
    expect(mockListMessages).toHaveBeenCalledWith(convId, LANDLORD_ID, 50, undefined);
  });

  it('200: tenant participant gets their page; forwards before + custom limit to service', async () => {
    const convId = randomUUID();
    const cursor = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    mockListMessages.mockResolvedValue({ messages: [], markedReadIds: [] });

    const res = await request(app)
      .get(`/api/conversations/${convId}/messages`)
      .query({ before: cursor, limit: '10' })
      .set('Authorization', 'Bearer the-tenant');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockListMessages).toHaveBeenCalledWith(convId, TENANT_ID, 10, cursor);
  });

  it('200: readAt side-effect surfaces in the response payload from the service', async () => {
    const convId = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    mockListMessages.mockResolvedValue({
      messages: [
        {
          id: 'm-1',
          authorId: TENANT_ID,
          content: 'Oi',
          createdAt: '2026-05-07T10:00:00.000Z',
          readAt: '2026-05-07T12:00:00.000Z',
        },
      ],
      markedReadIds: ['m-1'],
    });

    const res = await request(app)
      .get(`/api/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body[0].readAt).toBe('2026-05-07T12:00:00.000Z');
  });

  it('400: non-UUID id is rejected by Zod before touching the DB', async () => {
    const res = await request(app)
      .get('/api/conversations/not-a-uuid/messages')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it('400: non-UUID before cursor is rejected', async () => {
    const res = await request(app)
      .get(`/api/conversations/${randomUUID()}/messages`)
      .query({ before: 'not-a-uuid' })
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it('400: limit below 1 is rejected', async () => {
    const res = await request(app)
      .get(`/api/conversations/${randomUUID()}/messages`)
      .query({ limit: '0' })
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it('400: limit above 100 is rejected', async () => {
    const res = await request(app)
      .get(`/api/conversations/${randomUUID()}/messages`)
      .query({ limit: '101' })
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it('401: missing Authorization header is rejected before any DB/service call', async () => {
    const res = await request(app).get(`/api/conversations/${randomUUID()}/messages`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it('404: missing conversation returns NOT_FOUND (existence-hiding)', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/conversations/${randomUUID()}/messages`)
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it('404: non-participant gets NOT_FOUND, NOT 403 (existence-hiding)', async () => {
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });

    const res = await request(app)
      .get(`/api/conversations/${randomUUID()}/messages`)
      .set('Authorization', 'Bearer outsider');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockListMessages).not.toHaveBeenCalled();
  });
});
