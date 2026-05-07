import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase env vars must be present before importing app — validateAuthConfig
// runs at load time and importing src/app transitively pulls in firebase init.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';

const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const LANDLORD_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_ID = '44444444-4444-4444-4444-444444444444';

const { mockCreate, mockSendTicketCreated } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockSendTicketCreated: vi.fn(),
}));

// Header-driven auth switch — diferentes Authorization values mapeiam para
// diferentes (id, name, role). Reusa o padrão do rentalPaymentCurrent.test.ts
// e conversationResolve.test.ts.
vi.mock('../src/middlewares/authMiddleware', () => ({
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
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/services/supportTicketService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    supportTicketService: {
      ...actual.supportTicketService,
      create: mockCreate,
    },
  };
});

vi.mock('../src/services/supportEmailService', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    supportEmailService: {
      ...actual.supportEmailService,
      sendTicketCreated: mockSendTicketCreated,
      sendTicketUpdated: actual.supportEmailService.sendTicketUpdated,
    },
  };
});

import request from 'supertest';
import app from '../src/app';
import { SupportTicketError } from '../src/services/supportTicketService';

function seedTicket(overrides: Partial<any> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    code: 'SUP-260507-A3F2',
    title: 'App trava ao enviar foto',
    description: 'Quando tento enviar uma foto no chat, o app fecha sozinho.',
    userId: TENANT_ID,
    userName: 'Maria Silva',
    userRole: 'TENANT',
    status: 'OPEN',
    resolution: null,
    assignedToId: null,
    createdAt: new Date('2026-05-07T12:00:00Z'),
    updatedAt: new Date('2026-05-07T12:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTicketCreated.mockResolvedValue(undefined);
});

describe('POST /api/support/tickets — US-018', () => {
  it('creates a ticket and returns 201 with { id, code, title, description, createdAt, status }', async () => {
    const ticket = seedTicket();
    mockCreate.mockResolvedValue(ticket);

    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({
        title: ticket.title,
        description: ticket.description,
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: ticket.id,
      code: ticket.code,
      title: ticket.title,
      description: ticket.description,
      createdAt: ticket.createdAt.toISOString(),
      status: ticket.status,
    });
    expect(res.body.code).toMatch(/^SUP-\d{6}-[A-Z0-9]{4}$/);
    // userId/userName/userRole vêm do JWT, não do body
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TENANT_ID,
        name: 'Maria Silva',
        role: 'TENANT',
      }),
      {
        title: ticket.title,
        description: ticket.description,
      },
    );
  });

  it('landlord can open a ticket — userRole is captured as LANDLORD', async () => {
    mockCreate.mockResolvedValue(seedTicket({ userId: LANDLORD_ID, userRole: 'LANDLORD' }));

    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-landlord')
      .send({ title: 'Preciso de ajuda', description: 'Tenho uma dúvida sobre contrato.' });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: LANDLORD_ID, role: 'LANDLORD' }),
      expect.any(Object),
    );
  });

  it('admin can open a ticket — userRole is captured as ADMIN', async () => {
    mockCreate.mockResolvedValue(seedTicket({ userId: ADMIN_ID, userRole: 'ADMIN' }));

    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-admin')
      .send({ title: 'Bug interno', description: 'Relato interno para rastreio.' });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: ADMIN_ID, role: 'ADMIN' }),
      expect.any(Object),
    );
  });

  it('echoes title/description/status in the response body (US-009)', async () => {
    // Regression guard for US-009: the POST response must carry enough
    // fields that the frontend /support screen can reconstitute the ticket
    // card without having to preserve the request body in local cache.
    // Matches the SupportTicketUserView shape returned by GET /support/tickets.
    const ticket = seedTicket({
      title: 'Específico para o echo',
      description: 'Corpo longo com detalhes que o cache local precisa exibir.',
      status: 'OPEN',
    });
    mockCreate.mockResolvedValue(ticket);

    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({ title: ticket.title, description: ticket.description });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: ticket.id,
      code: ticket.code,
      title: ticket.title,
      description: ticket.description,
      createdAt: ticket.createdAt.toISOString(),
      status: 'OPEN',
    });
    // Admin-only fields must NOT leak into the POST echo — same boundary as
    // the SupportTicketUserView returned by listForUser.
    expect(res.body).not.toHaveProperty('user');
    expect(res.body).not.toHaveProperty('assignedTo');
    expect(res.body).not.toHaveProperty('resolution');
    expect(res.body).not.toHaveProperty('updatedAt');
    expect(res.body).not.toHaveProperty('userRole');
  });

  it('calls supportEmailService.sendTicketCreated after the DB insert', async () => {
    const ticket = seedTicket();
    mockCreate.mockResolvedValue(ticket);

    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({ title: ticket.title, description: ticket.description });

    expect(res.status).toBe(201);
    expect(mockSendTicketCreated).toHaveBeenCalledTimes(1);
    expect(mockSendTicketCreated).toHaveBeenCalledWith(ticket);
  });

  it('email failure does NOT fail the API request (still 201)', async () => {
    const ticket = seedTicket();
    mockCreate.mockResolvedValue(ticket);
    mockSendTicketCreated.mockRejectedValue(new Error('smtp down'));

    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({ title: ticket.title, description: ticket.description });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('code', ticket.code);
  });

  it('returns 401 UNAUTHORIZED when the Authorization header is missing', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .send({ title: 'X', description: 'Y' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendTicketCreated).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when title exceeds 120 chars', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({ title: 'x'.repeat(121), description: 'Valid description' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when description exceeds 4000 chars', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({ title: 'Valid', description: 'x'.repeat(4001) });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when title is missing', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({ description: 'Only description' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when description is missing', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({ title: 'Only title' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when title is empty string', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({ title: '', description: 'Valid' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('ignores client-supplied userId/userRole in body (server-derived from JWT)', async () => {
    const ticket = seedTicket();
    mockCreate.mockResolvedValue(ticket);

    await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({
        title: ticket.title,
        description: ticket.description,
        // Tentativa de forja — devem ser descartados pelo Zod (strict mode
        // não é ligado, mas o schema só reconhece title/description; extras
        // são simplesmente ignorados).
        userId: '00000000-0000-0000-0000-000000000000',
        userRole: 'ADMIN',
        code: 'SUP-260507-XXXX',
      });

    // Author passado ao service vem do JWT, não do body.
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: TENANT_ID, role: 'TENANT' }),
      { title: ticket.title, description: ticket.description },
    );
  });

  it('maps SupportTicketError from service to 500 CODE_GENERATION_FAILED', async () => {
    mockCreate.mockRejectedValue(
      new SupportTicketError(500, 'CODE_GENERATION_FAILED', 'retries exhausted'),
    );

    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', 'Bearer the-tenant')
      .send({ title: 'Valid', description: 'Valid' });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      status: 500,
      code: 'CODE_GENERATION_FAILED',
    });
  });
});
