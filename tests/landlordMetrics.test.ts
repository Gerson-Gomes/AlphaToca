import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_ID = '44444444-4444-4444-4444-444444444444';

const { mockProfileViewCount, mockProposalCount, mockConversationMessageCount } = vi.hoisted(() => ({
  mockProfileViewCount: vi.fn(),
  mockProposalCount: vi.fn(),
  mockConversationMessageCount: vi.fn(),
}));

// Preserve `requireRole` as the REAL middleware (via importOriginal) so that
// the 403 branch is actually exercised end-to-end — 401 comes from the
// checkJwt stub, 403 from the real requireRole operating on req.localUser.
vi.mock('../src/middlewares/authMiddleware', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    validateAuthConfig: () => {},
    checkJwt: (req: any, res: any, next: any) => {
      const header = req.headers.authorization;
      if (
        header === 'Bearer the-landlord' ||
        header === 'Bearer the-tenant' ||
        header === 'Bearer the-admin'
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
      let localUser: any = {
        id: LANDLORD_ID,
        firebaseUid: uid,
        name: 'João Locador',
        email: 'joao@demo.com',
        phoneNumber: '+5511999999000',
        role: 'LANDLORD',
        fcmToken: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      if (uid === 'Bearer the-tenant') {
        localUser = { ...localUser, id: TENANT_ID, name: 'Maria Silva', role: 'TENANT' };
      } else if (uid === 'Bearer the-admin') {
        localUser = { ...localUser, id: ADMIN_ID, name: 'Ana Admin', role: 'ADMIN' };
      }
      req.localUser = localUser;
      next();
    },
    // requireRole: real (uses req.localUser from the stub above)
  };
});

vi.mock('../src/config/db', () => ({
  default: {
    profileView: { count: mockProfileViewCount },
    proposal: { count: mockProposalCount },
    conversationMessage: { count: mockConversationMessageCount },
  },
}));

vi.mock('../src/config/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import request from 'supertest';
import app from '../src/app';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/landlord/metrics — LL-002', () => {
  it('200: returns profileViews + proposalsPending + unreadMessages for the authenticated landlord', async () => {
    mockProfileViewCount.mockResolvedValue(142);
    mockProposalCount.mockResolvedValue(3);
    mockConversationMessageCount.mockResolvedValue(7);

    const res = await request(app)
      .get('/api/landlord/metrics')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profileViews: 142,
      proposalsPending: 3,
      unreadMessages: 7,
    });

    // profileViews scoped to this landlord, last 30 days
    const profileCall = mockProfileViewCount.mock.calls[0][0];
    expect(profileCall.where.landlordId).toBe(LANDLORD_ID);
    expect(profileCall.where.viewedAt.gte).toBeInstanceOf(Date);
    const since: Date = profileCall.where.viewedAt.gte;
    const ms = Date.now() - since.getTime();
    // Roughly 30 days, allow 5s clock slack
    expect(ms).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000 - 5000);
    expect(ms).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 5000);

    // proposalsPending = PENDING across landlord's properties
    expect(mockProposalCount).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        property: { landlordId: LANDLORD_ID },
      },
    });

    // unreadMessages filter: counterpart-authored, still unread, landlord's threads
    expect(mockConversationMessageCount).toHaveBeenCalledWith({
      where: {
        readAt: null,
        conversation: { landlordId: LANDLORD_ID },
        authorId: { not: LANDLORD_ID },
      },
    });
  });

  it('200: returns unreadMessages=0 gracefully when ConversationMessage table does not exist yet (pre-LL-010)', async () => {
    mockProfileViewCount.mockResolvedValue(10);
    mockProposalCount.mockResolvedValue(1);
    // Simulate Prisma raising P2021 "table does not exist" — this is what
    // happens against the live DB until LL-010's migration is applied.
    const { Prisma } = await import('@prisma/client');
    const p2021 = new Prisma.PrismaClientKnownRequestError(
      'The table `conversation_messages` does not exist',
      { code: 'P2021', clientVersion: 'test' },
    );
    mockConversationMessageCount.mockRejectedValue(p2021);

    const res = await request(app)
      .get('/api/landlord/metrics')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profileViews: 10,
      proposalsPending: 1,
      unreadMessages: 0,
    });
  });

  it('200: returns zeros when landlord has no activity', async () => {
    mockProfileViewCount.mockResolvedValue(0);
    mockProposalCount.mockResolvedValue(0);
    mockConversationMessageCount.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/landlord/metrics')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profileViews: 0,
      proposalsPending: 0,
      unreadMessages: 0,
    });
  });

  it('401: missing Authorization header is rejected before any DB call', async () => {
    const res = await request(app).get('/api/landlord/metrics');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockProfileViewCount).not.toHaveBeenCalled();
    expect(mockProposalCount).not.toHaveBeenCalled();
    expect(mockConversationMessageCount).not.toHaveBeenCalled();
  });

  it('403: authenticated tenant is rejected by requireRole(LANDLORD)', async () => {
    const res = await request(app)
      .get('/api/landlord/metrics')
      .set('Authorization', 'Bearer the-tenant');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockProfileViewCount).not.toHaveBeenCalled();
    expect(mockProposalCount).not.toHaveBeenCalled();
    expect(mockConversationMessageCount).not.toHaveBeenCalled();
  });

  it('403: authenticated admin is also rejected — endpoint is LANDLORD-only', async () => {
    const res = await request(app)
      .get('/api/landlord/metrics')
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockProfileViewCount).not.toHaveBeenCalled();
  });
});
