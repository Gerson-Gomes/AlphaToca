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

const { mockCreateMessage, mockFindUnique } = vi.hoisted(() => ({
  mockCreateMessage: vi.fn(),
  mockFindUnique: vi.fn(),
}));

// Header-driven auth switch: same pattern as conversationMessages.test.ts so
// we can exercise landlord, tenant, and non-participant ("outsider") branches
// against the same mounted app.
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
      createMessage: mockCreateMessage,
    },
  };
});

import request from 'supertest';
import app from '../src/app';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/conversations/:id/messages — LL-013', () => {
  it('201: landlord participant persists a message and receives the full row', async () => {
    const convId = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    const created = {
      id: 'msg-1',
      authorId: LANDLORD_ID,
      content: 'Boa tarde!',
      createdAt: '2026-05-07T15:00:00.000Z',
      readAt: null,
    };
    mockCreateMessage.mockResolvedValue(created);

    const res = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer the-landlord')
      .send({ content: 'Boa tarde!' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    expect(mockCreateMessage).toHaveBeenCalledWith(convId, LANDLORD_ID, 'Boa tarde!');
  });

  it('201: tenant participant can also post to the thread', async () => {
    const convId = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    mockCreateMessage.mockResolvedValue({
      id: 'msg-2',
      authorId: TENANT_ID,
      content: 'Pode sim',
      createdAt: '2026-05-07T15:05:00.000Z',
      readAt: null,
    });

    const res = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer the-tenant')
      .send({ content: 'Pode sim' });

    expect(res.status).toBe(201);
    expect(res.body.authorId).toBe(TENANT_ID);
    expect(res.body.readAt).toBeNull();
    expect(mockCreateMessage).toHaveBeenCalledWith(convId, TENANT_ID, 'Pode sim');
  });

  it('400: empty content is rejected by Zod before the service runs', async () => {
    const convId = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });

    const res = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer the-landlord')
      .send({ content: '' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it('400: oversized content (4001 chars) is rejected', async () => {
    const convId = randomUUID();
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    const huge = 'x'.repeat(4001);

    const res = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer the-landlord')
      .send({ content: huge });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it('400: content=4000 (exact boundary) is accepted', async () => {
    const convId = randomUUID();
    const boundary = 'x'.repeat(4000);
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });
    mockCreateMessage.mockResolvedValue({
      id: 'msg-boundary',
      authorId: LANDLORD_ID,
      content: boundary,
      createdAt: '2026-05-07T15:10:00.000Z',
      readAt: null,
    });

    const res = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer the-landlord')
      .send({ content: boundary });

    expect(res.status).toBe(201);
    expect(mockCreateMessage).toHaveBeenCalledWith(convId, LANDLORD_ID, boundary);
  });

  it('400: missing content field in body is rejected', async () => {
    const convId = randomUUID();

    const res = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', 'Bearer the-landlord')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it('400: non-UUID :id is rejected before touching the DB', async () => {
    const res = await request(app)
      .post('/api/conversations/not-a-uuid/messages')
      .set('Authorization', 'Bearer the-landlord')
      .send({ content: 'hey' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it('401: missing Authorization header is rejected before any DB call', async () => {
    const res = await request(app)
      .post(`/api/conversations/${randomUUID()}/messages`)
      .send({ content: 'hey' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it('404: missing conversation returns NOT_FOUND (existence-hiding)', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/conversations/${randomUUID()}/messages`)
      .set('Authorization', 'Bearer the-landlord')
      .send({ content: 'hey' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it('404: non-participant gets NOT_FOUND, NOT 403 (existence-hiding)', async () => {
    mockFindUnique.mockResolvedValue({ landlordId: LANDLORD_ID, tenantId: TENANT_ID });

    const res = await request(app)
      .post(`/api/conversations/${randomUUID()}/messages`)
      .set('Authorization', 'Bearer outsider')
      .send({ content: 'hey' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });
});
