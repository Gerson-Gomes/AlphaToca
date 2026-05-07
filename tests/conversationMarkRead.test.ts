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

const { mockMarkAllRead, mockFindUnique, mockEmitMessagesRead, mockEmitNewMessage } = vi.hoisted(
  () => ({
    mockMarkAllRead: vi.fn(),
    mockFindUnique: vi.fn(),
    mockEmitMessagesRead: vi.fn(),
    mockEmitNewMessage: vi.fn(),
  }),
);

// Header-driven auth switch: Bearer the-landlord -> LANDLORD_ID, Bearer
// the-tenant -> TENANT_ID, Bearer outsider -> OUTSIDER_ID, else 401. Mirrors
// the pattern used in conversationMessages.test.ts / conversationMessageCreate.
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
      markAllRead: mockMarkAllRead,
    },
  };
});

// Unlike LL-012/LL-013 HTTP tests, this file DOES mock the socket service so we
// can assert the emit arguments deterministically. safeEmit would otherwise
// swallow the getIO failure silently and we'd have no visible side effect.
vi.mock('../src/services/conversationSocketService', () => ({
  conversationSocketService: {
    emitMessagesRead: mockEmitMessagesRead,
    emitNewMessage: mockEmitNewMessage,
  },
}));

import request from 'supertest';
import app from '../src/app';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/conversations/:id/read — LL-015', () => {
  it('200: marks messages read and returns the updated count', async () => {
    const convId = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    mockMarkAllRead.mockResolvedValue(['msg-1', 'msg-2', 'msg-3']);

    const res = await request(app)
      .post(`/api/conversations/${convId}/read`)
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ markedRead: 3 });
    expect(mockMarkAllRead).toHaveBeenCalledWith(convId, LANDLORD_ID);
  });

  it('200: 0-to-N transition — when nothing is unread, returns markedRead=0 and skips socket emit', async () => {
    const convId = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    mockMarkAllRead.mockResolvedValue([]);

    const res = await request(app)
      .post(`/api/conversations/${convId}/read`)
      .set('Authorization', 'Bearer the-tenant');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ markedRead: 0 });
    expect(mockMarkAllRead).toHaveBeenCalledWith(convId, TENANT_ID);
    expect(mockEmitMessagesRead).not.toHaveBeenCalled();
  });

  it('200: emits conversation:message_read via conversationSocketService when ids is non-empty', async () => {
    const convId = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    mockMarkAllRead.mockResolvedValue(['m-a', 'm-b']);

    await request(app)
      .post(`/api/conversations/${convId}/read`)
      .set('Authorization', 'Bearer the-landlord');

    expect(mockEmitMessagesRead).toHaveBeenCalledTimes(1);
    expect(mockEmitMessagesRead).toHaveBeenCalledWith(
      { id: convId, landlordId: LANDLORD_ID, tenantId: TENANT_ID },
      LANDLORD_ID,
      ['m-a', 'm-b'],
    );
  });

  it('200: tenant caller triggers emit with readerId=TENANT_ID (socket service routes to landlord)', async () => {
    const convId = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    mockMarkAllRead.mockResolvedValue(['only']);

    await request(app)
      .post(`/api/conversations/${convId}/read`)
      .set('Authorization', 'Bearer the-tenant');

    expect(mockEmitMessagesRead).toHaveBeenCalledWith(
      { id: convId, landlordId: LANDLORD_ID, tenantId: TENANT_ID },
      TENANT_ID,
      ['only'],
    );
  });

  it('400: non-UUID :id is rejected before any DB call', async () => {
    const res = await request(app)
      .post('/api/conversations/not-a-uuid/read')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockMarkAllRead).not.toHaveBeenCalled();
    expect(mockEmitMessagesRead).not.toHaveBeenCalled();
  });

  it('401: missing Authorization header is rejected before any DB call', async () => {
    const res = await request(app).post(`/api/conversations/${randomUUID()}/read`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockMarkAllRead).not.toHaveBeenCalled();
    expect(mockEmitMessagesRead).not.toHaveBeenCalled();
  });

  it('404: missing conversation returns NOT_FOUND (existence-hiding)', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/conversations/${randomUUID()}/read`)
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockMarkAllRead).not.toHaveBeenCalled();
    expect(mockEmitMessagesRead).not.toHaveBeenCalled();
  });

  it('404: non-participant gets NOT_FOUND (not 403) — same shape as missing conversation', async () => {
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });

    const res = await request(app)
      .post(`/api/conversations/${randomUUID()}/read`)
      .set('Authorization', 'Bearer outsider');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockMarkAllRead).not.toHaveBeenCalled();
    expect(mockEmitMessagesRead).not.toHaveBeenCalled();
  });
});
