import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const TENANT_A_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_B_ID = '55555555-5555-5555-5555-555555555555';
const LANDLORD_ID = '33333333-3333-3333-3333-333333333333';

const { mockListForUser } = vi.hoisted(() => ({
  mockListForUser: vi.fn(),
}));

// Header-driven auth switch — preserva o padrão `importOriginal` documentado
// em progress.txt Codebase Patterns: mantém `requireRole` REAL para que o
// 403 seja verificado a partir do req.localUser montado pelos stubs de
// checkJwt/authSyncMiddleware. Neste teste específico a rota não exige role,
// mas o padrão é o canônico.
vi.mock('../src/middlewares/authMiddleware', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    validateAuthConfig: () => {},
    checkJwt: (req: any, res: any, next: any) => {
      const header = req.headers.authorization;
      if (
        header === 'Bearer the-tenant-a' ||
        header === 'Bearer the-tenant-b' ||
        header === 'Bearer the-landlord'
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
        id: TENANT_A_ID,
        firebaseUid: uid,
        name: 'Maria Silva',
        email: 'maria@demo.com',
        phoneNumber: '+5511999999000',
        role: 'TENANT',
        fcmToken: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      if (uid === 'Bearer the-tenant-b') {
        localUser = { ...localUser, id: TENANT_B_ID, name: 'Carlos Souza' };
      } else if (uid === 'Bearer the-landlord') {
        localUser = { ...localUser, id: LANDLORD_ID, name: 'João Locador', role: 'LANDLORD' };
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
      listForUser: mockListForUser,
    },
  };
});

import request from 'supertest';
import app from '../src/app';

function seedTicketView(overrides: Partial<any> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    code: 'SUP-260507-A001',
    title: 'Problema no chat',
    description: 'App fecha sozinho ao enviar foto.',
    createdAt: '2026-05-07T12:00:00.000Z',
    status: 'OPEN',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/support/tickets — US-003', () => {
  it('returns 200 with the list of tickets belonging to the authenticated user', async () => {
    const tickets = [
      seedTicketView({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        code: 'SUP-260507-A001',
        createdAt: '2026-05-07T12:00:00.000Z',
      }),
      seedTicketView({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
        code: 'SUP-260506-B002',
        createdAt: '2026-05-06T12:00:00.000Z',
        title: 'Foto não carrega',
        description: 'Imagens mostram placeholder de casa.',
      }),
    ];
    mockListForUser.mockResolvedValue(tickets);

    const res = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant-a');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(tickets);
    expect(mockListForUser).toHaveBeenCalledTimes(1);
    expect(mockListForUser).toHaveBeenCalledWith(TENANT_A_ID);
  });

  it('returns an empty array when the user has no tickets', async () => {
    mockListForUser.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant-b');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockListForUser).toHaveBeenCalledWith(TENANT_B_ID);
  });

  it('item shape has the 6 required fields (id, code, title, description, createdAt, status)', async () => {
    mockListForUser.mockResolvedValue([seedTicketView()]);

    const res = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant-a');

    expect(res.status).toBe(200);
    const item = res.body[0];
    expect(item).toMatchObject({
      id: expect.any(String),
      code: expect.stringMatching(/^SUP-\d{6}-[A-Z0-9]{4}$/),
      title: expect.any(String),
      description: expect.any(String),
      createdAt: expect.any(String),
      status: expect.stringMatching(/^(OPEN|RESOLVED)$/),
    });
    // Admin-only fields stay out — user shouldn't see the triage metadata
    expect(item).not.toHaveProperty('resolution');
    expect(item).not.toHaveProperty('assignedTo');
    expect(item).not.toHaveProperty('user');
    expect(item).not.toHaveProperty('updatedAt');
  });

  it('only returns tickets for the authenticated user — user A sees only their tickets', async () => {
    // Simulate the service returning user A's tickets only
    const userATickets = [
      seedTicketView({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', code: 'SUP-260507-A001' }),
    ];
    mockListForUser.mockResolvedValue(userATickets);

    const res = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant-a');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(userATickets);
    // The key assertion: the service was called with TENANT_A_ID, not any
    // other id. The service has the where-clause responsibility; here we
    // verify the controller forwards the correct id unchanged.
    expect(mockListForUser).toHaveBeenCalledWith(TENANT_A_ID);
    expect(mockListForUser).not.toHaveBeenCalledWith(TENANT_B_ID);
  });

  it('only returns tickets for the authenticated user — user B sees only theirs', async () => {
    const userBTickets = [
      seedTicketView({
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
        code: 'SUP-260507-B001',
        title: 'Outro problema',
        description: 'Ticket do usuário B.',
      }),
    ];
    mockListForUser.mockResolvedValue(userBTickets);

    const res = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant-b');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(userBTickets);
    expect(mockListForUser).toHaveBeenCalledWith(TENANT_B_ID);
    expect(mockListForUser).not.toHaveBeenCalledWith(TENANT_A_ID);
  });

  it('landlord can list their own tickets — role does not change the filter', async () => {
    const landlordTickets = [
      seedTicketView({
        id: 'cccccccc-cccc-cccc-cccc-ccccccccccc1',
        code: 'SUP-260507-L001',
        title: 'Dúvida sobre contrato',
        description: 'Como alterar um contrato ativo?',
      }),
    ];
    mockListForUser.mockResolvedValue(landlordTickets);

    const res = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', 'Bearer the-landlord');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(landlordTickets);
    expect(mockListForUser).toHaveBeenCalledWith(LANDLORD_ID);
  });

  it('returns 401 UNAUTHORIZED when the Authorization header is missing', async () => {
    const res = await request(app).get('/api/support/tickets');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockListForUser).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHORIZED when the Authorization header is invalid', async () => {
    const res = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockListForUser).not.toHaveBeenCalled();
  });
});
