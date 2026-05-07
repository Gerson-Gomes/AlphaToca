import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const LANDLORD_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_ID = '44444444-4444-4444-4444-444444444444';
const TICKET_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const { mockUpdateForAdmin, mockSendTicketUpdated } = vi.hoisted(() => ({
  mockUpdateForAdmin: vi.fn(),
  mockSendTicketUpdated: vi.fn(),
}));

// Preserva `requireRole` REAL (do importOriginal) — o 403 precisa vir do
// middleware real operando em cima do req.localUser que o authSyncMiddleware
// stub monta. Ver tests/adminSupportTicketsList.test.ts (US-019) para o
// mesmo padrão.
vi.mock('../src/middlewares/authMiddleware', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    validateAuthConfig: () => {},
    checkJwt: (req: any, res: any, next: any) => {
      const header = req.headers.authorization;
      if (
        header === 'Bearer the-tenant' ||
        header === 'Bearer the-landlord' ||
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
      let localUser = {
        id: TENANT_ID,
        firebaseUid: uid,
        name: 'Maria Silva',
        email: 'maria@demo.com',
        phoneNumber: '+5511999999000',
        role: 'TENANT',
        fcmToken: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      if (uid === 'Bearer the-landlord') {
        localUser = { ...localUser, id: LANDLORD_ID, name: 'João Locador', role: 'LANDLORD' };
      } else if (uid === 'Bearer the-admin') {
        localUser = { ...localUser, id: ADMIN_ID, name: 'Ana Admin', role: 'ADMIN' };
      }
      req.localUser = localUser;
      next();
    },
  };
});

vi.mock('../src/services/supportTicketService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    supportTicketService: {
      ...actual.supportTicketService,
      updateForAdmin: mockUpdateForAdmin,
    },
  };
});

vi.mock('../src/services/supportEmailService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    supportEmailService: {
      ...actual.supportEmailService,
      sendTicketUpdated: mockSendTicketUpdated,
    },
  };
});

import request from 'supertest';
import app from '../src/app';
import { SupportTicketError } from '../src/services/supportTicketService';

function resolvedView(overrides: Partial<any> = {}) {
  return {
    id: TICKET_ID,
    code: 'SUP-260507-A001',
    title: 'Problema no chat',
    description: 'Descrição do ticket',
    user: {
      id: TENANT_ID,
      name: 'Maria Silva',
      email: 'maria@demo.com',
      role: 'TENANT',
    },
    status: 'RESOLVED',
    createdAt: '2026-05-07T12:00:00.000Z',
    updatedAt: '2026-05-07T13:00:00.000Z',
    assignedTo: { id: ADMIN_ID, name: 'Ana Admin' },
    resolution: 'Problema resolvido após análise.',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTicketUpdated.mockResolvedValue(undefined);
});

describe('PUT /api/admin/support/tickets/:id — US-020', () => {
  it('admin can resolve ticket with resolution → 200 with RESOLVED + resolution', async () => {
    mockUpdateForAdmin.mockResolvedValueOnce(resolvedView());

    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ status: 'RESOLVED', resolution: 'Problema resolvido após análise.' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: TICKET_ID,
      status: 'RESOLVED',
      resolution: 'Problema resolvido após análise.',
    });
    expect(mockUpdateForAdmin).toHaveBeenCalledTimes(1);
    expect(mockUpdateForAdmin).toHaveBeenCalledWith(TICKET_ID, {
      status: 'RESOLVED',
      resolution: 'Problema resolvido após análise.',
    });
  });

  it('admin can update resolution only (no status change) → 200', async () => {
    mockUpdateForAdmin.mockResolvedValueOnce(
      resolvedView({ status: 'OPEN', resolution: 'Nota intermediária.' }),
    );

    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ resolution: 'Nota intermediária.' });

    expect(res.status).toBe(200);
    expect(mockUpdateForAdmin).toHaveBeenCalledWith(TICKET_ID, {
      resolution: 'Nota intermediária.',
    });
    // Email só é disparado em mudança de status.
    expect(mockSendTicketUpdated).not.toHaveBeenCalled();
  });

  it('admin can assign ticket → 200 with assignedTo populated', async () => {
    mockUpdateForAdmin.mockResolvedValueOnce(
      resolvedView({ status: 'OPEN', resolution: null }),
    );

    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ assignedToId: ADMIN_ID });

    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toEqual({ id: ADMIN_ID, name: 'Ana Admin' });
    expect(mockUpdateForAdmin).toHaveBeenCalledWith(TICKET_ID, {
      assignedToId: ADMIN_ID,
    });
  });

  it('admin can reopen ticket (RESOLVED → OPEN) without resolution → 200', async () => {
    mockUpdateForAdmin.mockResolvedValueOnce(
      resolvedView({ status: 'OPEN', resolution: 'Resolução anterior' }),
    );

    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ status: 'OPEN' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OPEN');
    expect(mockUpdateForAdmin).toHaveBeenCalledWith(TICKET_ID, { status: 'OPEN' });
  });

  it('on successful status change, invokes supportEmailService.sendTicketUpdated (best-effort)', async () => {
    mockUpdateForAdmin.mockResolvedValueOnce(resolvedView());

    await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ status: 'RESOLVED', resolution: 'OK' });

    expect(mockSendTicketUpdated).toHaveBeenCalledTimes(1);
    const envelope = mockSendTicketUpdated.mock.calls[0][0];
    expect(envelope.id).toBe(TICKET_ID);
    expect(envelope.status).toBe('RESOLVED');
  });

  it('email send failure does NOT fail the request (logged, not fatal)', async () => {
    mockUpdateForAdmin.mockResolvedValueOnce(resolvedView());
    mockSendTicketUpdated.mockRejectedValueOnce(new Error('SMTP down'));

    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ status: 'RESOLVED', resolution: 'OK' });

    expect(res.status).toBe(200);
  });

  it('returns 400 VALIDATION_ERROR when status=RESOLVED without resolution', async () => {
    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ status: 'RESOLVED' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockUpdateForAdmin).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when body is empty', async () => {
    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockUpdateForAdmin).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when status is not OPEN|RESOLVED', async () => {
    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ status: 'INVALID' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockUpdateForAdmin).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when assignedToId is not a UUID', async () => {
    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ assignedToId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockUpdateForAdmin).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when resolution is empty string', async () => {
    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ resolution: '' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockUpdateForAdmin).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when path id is not a UUID', async () => {
    const res = await request(app)
      .put(`/api/admin/support/tickets/not-a-uuid`)
      .set('Authorization', 'Bearer the-admin')
      .send({ status: 'OPEN' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockUpdateForAdmin).not.toHaveBeenCalled();
  });

  it('returns 400 ASSIGNEE_NOT_FOUND when assignedToId does not exist', async () => {
    mockUpdateForAdmin.mockRejectedValueOnce(
      new SupportTicketError(400, 'ASSIGNEE_NOT_FOUND', 'Assignee user X not found.'),
    );

    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ assignedToId: '99999999-9999-9999-9999-999999999999' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'ASSIGNEE_NOT_FOUND');
  });

  it('returns 404 TICKET_NOT_FOUND when the ticket does not exist', async () => {
    mockUpdateForAdmin.mockRejectedValueOnce(
      new SupportTicketError(404, 'TICKET_NOT_FOUND', 'Ticket X not found.'),
    );

    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-admin')
      .send({ status: 'OPEN' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'TICKET_NOT_FOUND');
  });

  it('returns 403 for non-admin authenticated user (TENANT)', async () => {
    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-tenant')
      .send({ status: 'RESOLVED', resolution: 'x' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockUpdateForAdmin).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin authenticated user (LANDLORD)', async () => {
    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .set('Authorization', 'Bearer the-landlord')
      .send({ status: 'RESOLVED', resolution: 'x' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockUpdateForAdmin).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(app)
      .put(`/api/admin/support/tickets/${TICKET_ID}`)
      .send({ status: 'OPEN' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockUpdateForAdmin).not.toHaveBeenCalled();
  });
});
