import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const LANDLORD_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_ID = '44444444-4444-4444-4444-444444444444';

const { mockList } = vi.hoisted(() => ({
  mockList: vi.fn(),
}));

// Header-driven auth switch — mesma convenção dos outros testes HTTP de
// rotas autenticadas (conversationResolve, supportTicketCreate, etc).
// IMPORTANTE: precisamos preservar `requireRole` como o REAL do middleware
// (não stub) para que o teste de 403 funcione de verdade — o 401 vem do
// checkJwt stub, o 403 vem do requireRole real operando em cima do
// req.localUser que o authSyncMiddleware stub monta.
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
    // requireRole = real (usa req.localUser do stub acima)
  };
});

vi.mock('../src/services/supportTicketService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    supportTicketService: {
      ...actual.supportTicketService,
      list: mockList,
    },
  };
});

import request from 'supertest';
import app from '../src/app';

function seedEnvelope(overrides: Partial<any> = {}) {
  return {
    data: [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        code: 'SUP-260507-A001',
        title: 'Problema no chat',
        description: 'Descrição do ticket A',
        user: {
          id: TENANT_ID,
          name: 'Maria Silva',
          email: 'maria@demo.com',
          role: 'TENANT',
        },
        status: 'OPEN',
        createdAt: '2026-05-07T12:00:00.000Z',
        updatedAt: '2026-05-07T12:00:00.000Z',
        assignedTo: null,
        resolution: null,
      },
    ],
    page: 1,
    pageSize: 50,
    total: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/support/tickets — US-019', () => {
  it('admin can list tickets — 200 with { data, page, pageSize, total } envelope', async () => {
    const envelope = seedEnvelope();
    mockList.mockResolvedValue(envelope);

    const res = await request(app)
      .get('/api/admin/support/tickets')
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(envelope);
    expect(mockList).toHaveBeenCalledTimes(1);
    // Sem filtros: status/role/from/to ausentes; page/pageSize defaultados.
    expect(mockList).toHaveBeenCalledWith({
      status: undefined,
      role: undefined,
      from: undefined,
      to: undefined,
      page: 1,
      pageSize: 50,
    });
  });

  it('ticket item has all required fields (id, code, title, description, user{id,name,email,role}, status, createdAt, updatedAt, assignedTo?, resolution?)', async () => {
    const envelope = seedEnvelope({
      data: [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
          code: 'SUP-260507-B002',
          title: 'Resolvido',
          description: 'Ticket já fechado',
          user: {
            id: LANDLORD_ID,
            name: 'João Locador',
            email: 'joao@demo.com',
            role: 'LANDLORD',
          },
          status: 'RESOLVED',
          createdAt: '2026-05-06T12:00:00.000Z',
          updatedAt: '2026-05-07T09:00:00.000Z',
          assignedTo: { id: ADMIN_ID, name: 'Ana Admin' },
          resolution: 'Problema resolvido após análise.',
        },
      ],
      total: 1,
    });
    mockList.mockResolvedValue(envelope);

    const res = await request(app)
      .get('/api/admin/support/tickets')
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(200);
    const item = res.body.data[0];
    expect(item).toMatchObject({
      id: expect.any(String),
      code: expect.stringMatching(/^SUP-\d{6}-[A-Z0-9]{4}$/),
      title: expect.any(String),
      description: expect.any(String),
      user: {
        id: LANDLORD_ID,
        name: 'João Locador',
        email: 'joao@demo.com',
        role: 'LANDLORD',
      },
      status: 'RESOLVED',
      assignedTo: { id: ADMIN_ID, name: 'Ana Admin' },
      resolution: 'Problema resolvido após análise.',
    });
  });

  it('applies combined filters (status + role + from + to) and forwards them to the service', async () => {
    mockList.mockResolvedValue(seedEnvelope({ total: 0, data: [] }));

    const res = await request(app)
      .get('/api/admin/support/tickets')
      .query({
        status: 'RESOLVED',
        role: 'LANDLORD',
        from: '2026-05-01T00:00:00Z',
        to: '2026-05-31T23:59:59Z',
        page: '2',
        pageSize: '10',
      })
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith({
      status: 'RESOLVED',
      role: 'LANDLORD',
      from: new Date('2026-05-01T00:00:00Z'),
      to: new Date('2026-05-31T23:59:59Z'),
      page: 2,
      pageSize: 10,
    });
  });

  it('page/pageSize have sane defaults (1 and 50) when omitted', async () => {
    mockList.mockResolvedValue(seedEnvelope());

    await request(app)
      .get('/api/admin/support/tickets')
      .set('Authorization', 'Bearer the-admin');

    const arg = mockList.mock.calls[0][0];
    expect(arg.page).toBe(1);
    expect(arg.pageSize).toBe(50);
  });

  it('returns 403 for non-admin authenticated user (TENANT)', async () => {
    const res = await request(app)
      .get('/api/admin/support/tickets')
      .set('Authorization', 'Bearer the-tenant');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin authenticated user (LANDLORD)', async () => {
    const res = await request(app)
      .get('/api/admin/support/tickets')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(app).get('/api/admin/support/tickets');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when status is not OPEN|RESOLVED', async () => {
    const res = await request(app)
      .get('/api/admin/support/tickets')
      .query({ status: 'INVALID' })
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when role is ADMIN (not allowed in this filter)', async () => {
    const res = await request(app)
      .get('/api/admin/support/tickets')
      .query({ role: 'ADMIN' })
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when page is < 1', async () => {
    const res = await request(app)
      .get('/api/admin/support/tickets')
      .query({ page: '0' })
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when pageSize exceeds 200', async () => {
    const res = await request(app)
      .get('/api/admin/support/tickets')
      .query({ pageSize: '201' })
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when from > to', async () => {
    const res = await request(app)
      .get('/api/admin/support/tickets')
      .query({ from: '2026-06-01T00:00:00Z', to: '2026-05-01T00:00:00Z' })
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when from is not a valid ISO date', async () => {
    const res = await request(app)
      .get('/api/admin/support/tickets')
      .query({ from: 'not-a-date' })
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('accepts YYYY-MM-DD as from/to (common calendar-picker output)', async () => {
    mockList.mockResolvedValue(seedEnvelope({ data: [], total: 0 }));

    const res = await request(app)
      .get('/api/admin/support/tickets')
      .query({ from: '2026-05-01', to: '2026-05-31' })
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date('2026-05-01'),
        to: new Date('2026-05-31'),
      }),
    );
  });

  it('paginated envelope: total reflects DB count, not page size', async () => {
    // Um total alto com apenas pageSize items na página — envelope deve
    // preservar o total como está (o service já retorna esse contrato).
    mockList.mockResolvedValue(
      seedEnvelope({
        data: new Array(10).fill(null).map((_, i) => ({
          id: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa${String(i).padStart(2, '0')}`,
          code: `SUP-260507-A${String(i).padStart(3, '0')}`,
          title: `Ticket ${i}`,
          description: `Descrição ${i}`,
          user: {
            id: TENANT_ID,
            name: 'Maria Silva',
            email: 'maria@demo.com',
            role: 'TENANT',
          },
          status: 'OPEN',
          createdAt: '2026-05-07T12:00:00.000Z',
          updatedAt: '2026-05-07T12:00:00.000Z',
          assignedTo: null,
          resolution: null,
        })),
        page: 1,
        pageSize: 10,
        total: 87,
      }),
    );

    const res = await request(app)
      .get('/api/admin/support/tickets')
      .query({ pageSize: '10' })
      .set('Authorization', 'Bearer the-admin');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.total).toBe(87);
    expect(res.body.pageSize).toBe(10);
  });
});
