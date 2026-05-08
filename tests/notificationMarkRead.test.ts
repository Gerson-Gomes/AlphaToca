import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const USER_A_ID = '22222222-2222-2222-2222-222222222222';
const USER_B_ID = '55555555-5555-5555-5555-555555555555';
const NOTIFICATION_ID = 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn1';
const UNKNOWN_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const { mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../src/config/db', () => ({
  default: {
    notification: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

// `importOriginal` auth mock (keeps requireRole real, stubs checkJwt/authSyncMiddleware).
vi.mock('../src/middlewares/authMiddleware', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    validateAuthConfig: () => {},
    checkJwt: (req: any, res: any, next: any) => {
      const header = req.headers.authorization;
      if (header === 'Bearer the-user-a' || header === 'Bearer the-user-b') {
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
      let localUser = {
        id: USER_A_ID,
        firebaseUid: uid,
        name: 'User A',
        email: 'a@demo.com',
        phoneNumber: '+5511999999000',
        role: 'TENANT',
        fcmToken: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      if (uid === 'Bearer the-user-b') {
        localUser = { ...localUser, id: USER_B_ID, name: 'User B' };
      }
      req.localUser = localUser;
      next();
    },
  };
});

import request from 'supertest';
import app from '../src/app';

function seedNotificationRow(overrides: Partial<any> = {}) {
  return {
    id: NOTIFICATION_ID,
    userId: USER_A_ID,
    readAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /api/notifications/:id/read — US-014 (idempotent cross-device sync)', () => {
  it('returns 204 and sets readAt when the notification was unread', async () => {
    mockFindUnique.mockResolvedValue(seedNotificationRow({ readAt: null }));
    mockUpdate.mockResolvedValue({ ...seedNotificationRow(), readAt: new Date() });

    const res = await request(app)
      .put(`/api/notifications/${NOTIFICATION_ID}/read`)
      .set('Authorization', 'Bearer the-user-a');

    expect(res.status).toBe(204);
    // No JSON body on 204 — supertest surfaces body as empty object or empty string.
    expect(res.body).toEqual({});
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      select: { id: true, userId: true, readAt: true },
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: { readAt: expect.any(Date) },
    });
  });

  it('is idempotent — returns 204 without calling update when readAt is already set', async () => {
    const previouslyRead = new Date('2026-05-05T10:00:00.000Z');
    mockFindUnique.mockResolvedValue(seedNotificationRow({ readAt: previouslyRead }));

    const res = await request(app)
      .put(`/api/notifications/${NOTIFICATION_ID}/read`)
      .set('Authorization', 'Bearer the-user-a');

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    // Crucial: no write — the original readAt must be preserved across devices.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is not the owner (no write, no leak)', async () => {
    // Row belongs to user B; caller is user A.
    mockFindUnique.mockResolvedValue(seedNotificationRow({ userId: USER_B_ID }));

    const res = await request(app)
      .put(`/api/notifications/${NOTIFICATION_ID}/read`)
      .set('Authorization', 'Bearer the-user-a');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when the notification does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .put(`/api/notifications/${UNKNOWN_ID}/read`)
      .set('Authorization', 'Bearer the-user-a');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(app).put(`/api/notifications/${NOTIFICATION_ID}/read`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('scopes ownership strictly by req.localUser.id — user B cannot mark user A\'s row', async () => {
    mockFindUnique.mockResolvedValue(seedNotificationRow({ userId: USER_A_ID }));

    const res = await request(app)
      .put(`/api/notifications/${NOTIFICATION_ID}/read`)
      .set('Authorization', 'Bearer the-user-b');

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not update when the FIND throws — surfaced as 500 via errorHandler', async () => {
    mockFindUnique.mockRejectedValue(new Error('db unreachable'));

    const res = await request(app)
      .put(`/api/notifications/${NOTIFICATION_ID}/read`)
      .set('Authorization', 'Bearer the-user-a');

    expect(res.status).toBe(500);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
