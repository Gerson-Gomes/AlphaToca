import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupportTicketStatus, SupportUserRole } from '@prisma/client';

// Mock de `../src/config/db` deve vir antes de importar o serviço, caso
// contrário o módulo real do Prisma é puxado e tenta conectar no banco.
vi.mock('../src/config/db', () => ({
  default: {
    supportTicket: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import prisma from '../src/config/db';
import {
  supportTicketService,
  generateTicketCode,
  SupportTicketError,
} from '../src/services/supportTicketService';

const author = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Maria Silva',
  role: SupportUserRole.TENANT,
};

const payload = {
  title: 'App trava ao enviar foto',
  description: 'O app fecha quando seleciono uma foto da galeria no chat.',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateTicketCode()', () => {
  it('returns a code in the format SUP-AAMMDD-XXXX', () => {
    const code = generateTicketCode(new Date('2026-05-07T12:00:00'));
    expect(code).toMatch(/^SUP-\d{6}-[A-Z0-9]{4}$/);
  });

  it('uses the local date (YY MM DD) not UTC', () => {
    // Usar uma data simples — o teste valida que AAMMDD existe e tem 6 dígitos
    // sem depender do TZ do host de CI.
    const code = generateTicketCode(new Date(2026, 4, 7, 12, 0, 0)); // mês é 0-indexed
    expect(code.startsWith('SUP-260507-')).toBe(true);
  });

  it('includes a 4-char base36 uppercase suffix', () => {
    const suffixes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const code = generateTicketCode(new Date('2026-05-07T12:00:00'));
      const suffix = code.split('-').pop()!;
      expect(suffix).toMatch(/^[A-Z0-9]{4}$/);
      suffixes.add(suffix);
    }
    // 20 amostras sobre ~1.7M possíveis — probabilidade de colisão completa
    // é ~0. Se cair, algo está errado no gerador.
    expect(suffixes.size).toBeGreaterThan(1);
  });
});

describe('supportTicketService.create()', () => {
  it('inserts a ticket with server-derived fields and returns the row', async () => {
    const createdAt = new Date('2026-05-07T12:00:00Z');
    const inserted = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      code: 'SUP-260507-A3F2',
      title: payload.title,
      description: payload.description,
      userId: author.id,
      userName: author.name,
      userRole: author.role,
      status: 'OPEN',
      resolution: null,
      assignedToId: null,
      createdAt,
      updatedAt: createdAt,
    };
    (prisma.supportTicket.create as any).mockResolvedValueOnce(inserted);

    const result = await supportTicketService.create(author, payload);

    expect(result).toBe(inserted);
    expect(prisma.supportTicket.create).toHaveBeenCalledTimes(1);
    const arg = (prisma.supportTicket.create as any).mock.calls[0][0];
    expect(arg.data).toMatchObject({
      title: payload.title,
      description: payload.description,
      userId: author.id,
      userName: author.name,
      userRole: author.role,
    });
    // `code` é gerado no serviço — não vem do caller. Só validamos o formato.
    expect(arg.data.code).toMatch(/^SUP-\d{6}-[A-Z0-9]{4}$/);
    // status/resolution/assignedToId não são passados no data — ficam no
    // default do schema (OPEN / null / null).
    expect(arg.data.status).toBeUndefined();
    expect(arg.data.resolution).toBeUndefined();
    expect(arg.data.assignedToId).toBeUndefined();
  });

  it('retries on P2002 unique collision on `code` and succeeds on second attempt', async () => {
    const collision = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['code'] },
    });
    const inserted = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      code: 'SUP-260507-BBBB',
      title: payload.title,
      description: payload.description,
      userId: author.id,
      userName: author.name,
      userRole: author.role,
      status: 'OPEN',
      resolution: null,
      assignedToId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.supportTicket.create as any)
      .mockRejectedValueOnce(collision)
      .mockResolvedValueOnce(inserted);

    const result = await supportTicketService.create(author, payload);

    expect(result).toBe(inserted);
    expect(prisma.supportTicket.create).toHaveBeenCalledTimes(2);
  });

  it('bubbles SupportTicketError(500, CODE_GENERATION_FAILED) after 5 collisions', async () => {
    const collision = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['code'] },
    });
    (prisma.supportTicket.create as any).mockRejectedValue(collision);

    await expect(supportTicketService.create(author, payload)).rejects.toMatchObject({
      httpStatus: 500,
      code: 'CODE_GENERATION_FAILED',
    });
    expect(prisma.supportTicket.create).toHaveBeenCalledTimes(5);
  });

  it('does NOT retry on a non-P2002 error (e.g., FK violation) — rethrows immediately', async () => {
    const fkError = Object.assign(new Error('Foreign key constraint failed'), {
      code: 'P2003',
      meta: { field_name: 'userId' },
    });
    (prisma.supportTicket.create as any).mockRejectedValueOnce(fkError);

    await expect(supportTicketService.create(author, payload)).rejects.toBe(fkError);
    expect(prisma.supportTicket.create).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on P2002 on a different column (only `code` is regenerable)', async () => {
    const collision = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['id'] },
    });
    (prisma.supportTicket.create as any).mockRejectedValueOnce(collision);

    await expect(supportTicketService.create(author, payload)).rejects.toBe(collision);
    expect(prisma.supportTicket.create).toHaveBeenCalledTimes(1);
  });

  it('SupportTicketError is instanceof Error with httpStatus/code/message', () => {
    const err = new SupportTicketError(500, 'X', 'msg');
    expect(err).toBeInstanceOf(Error);
    expect(err.httpStatus).toBe(500);
    expect(err.code).toBe('X');
    expect(err.message).toBe('msg');
  });
});

describe('supportTicketService.list() — US-019', () => {
  const sampleRow = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
    code: 'SUP-260507-A001',
    title: 'App trava',
    description: 'Descrição',
    userId: author.id,
    userName: author.name,
    userRole: SupportUserRole.TENANT,
    status: SupportTicketStatus.OPEN,
    resolution: null,
    assignedToId: null,
    createdAt: new Date('2026-05-07T12:00:00Z'),
    updatedAt: new Date('2026-05-07T12:00:00Z'),
    user: {
      id: author.id,
      name: author.name,
      email: 'maria@demo.com',
      role: 'TENANT',
    },
    assignedTo: null,
  };

  it('returns the envelope { data, page, pageSize, total } with ISO-serialized dates', async () => {
    (prisma.supportTicket.count as any).mockResolvedValueOnce(1);
    (prisma.supportTicket.findMany as any).mockResolvedValueOnce([sampleRow]);

    const result = await supportTicketService.list({ page: 1, pageSize: 50 });

    expect(result).toEqual({
      data: [
        {
          id: sampleRow.id,
          code: sampleRow.code,
          title: sampleRow.title,
          description: sampleRow.description,
          user: {
            id: author.id,
            name: author.name,
            email: 'maria@demo.com',
            role: 'TENANT',
          },
          status: SupportTicketStatus.OPEN,
          createdAt: sampleRow.createdAt.toISOString(),
          updatedAt: sampleRow.updatedAt.toISOString(),
          assignedTo: null,
          resolution: null,
        },
      ],
      page: 1,
      pageSize: 50,
      total: 1,
    });
  });

  it('orders by createdAt DESC and applies skip/take from page/pageSize', async () => {
    (prisma.supportTicket.count as any).mockResolvedValueOnce(0);
    (prisma.supportTicket.findMany as any).mockResolvedValueOnce([]);

    await supportTicketService.list({ page: 3, pageSize: 20 });

    const arg = (prisma.supportTicket.findMany as any).mock.calls[0][0];
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.skip).toBe(40); // (3-1)*20
    expect(arg.take).toBe(20);
  });

  it('includes user {id,name,email,role} and assignedTo {id,name} via Prisma include (no N+1)', async () => {
    (prisma.supportTicket.count as any).mockResolvedValueOnce(0);
    (prisma.supportTicket.findMany as any).mockResolvedValueOnce([]);

    await supportTicketService.list({ page: 1, pageSize: 50 });

    const arg = (prisma.supportTicket.findMany as any).mock.calls[0][0];
    expect(arg.include).toEqual({
      user: { select: { id: true, name: true, email: true, role: true } },
      assignedTo: { select: { id: true, name: true } },
    });
    // count + findMany == 2 queries; no N+1 com pageSize.
    expect(prisma.supportTicket.count).toHaveBeenCalledTimes(1);
    expect(prisma.supportTicket.findMany).toHaveBeenCalledTimes(1);
  });

  it('builds where clause with combined status/role/from/to filters', async () => {
    (prisma.supportTicket.count as any).mockResolvedValueOnce(0);
    (prisma.supportTicket.findMany as any).mockResolvedValueOnce([]);

    const from = new Date('2026-05-01T00:00:00Z');
    const to = new Date('2026-05-31T23:59:59Z');
    await supportTicketService.list({
      status: SupportTicketStatus.RESOLVED,
      role: SupportUserRole.LANDLORD,
      from,
      to,
      page: 1,
      pageSize: 50,
    });

    const arg = (prisma.supportTicket.findMany as any).mock.calls[0][0];
    expect(arg.where).toEqual({
      status: SupportTicketStatus.RESOLVED,
      userRole: SupportUserRole.LANDLORD,
      createdAt: { gte: from, lte: to },
    });
    // count usa o MESMO where — total reflete os filtros.
    const countArg = (prisma.supportTicket.count as any).mock.calls[0][0];
    expect(countArg.where).toEqual(arg.where);
  });

  it('omits where entries that are not set (zero filters returns all)', async () => {
    (prisma.supportTicket.count as any).mockResolvedValueOnce(0);
    (prisma.supportTicket.findMany as any).mockResolvedValueOnce([]);

    await supportTicketService.list({ page: 1, pageSize: 50 });

    const arg = (prisma.supportTicket.findMany as any).mock.calls[0][0];
    expect(arg.where).toEqual({}); // sem filtros
  });

  it('only sets createdAt.gte when only `from` is provided', async () => {
    (prisma.supportTicket.count as any).mockResolvedValueOnce(0);
    (prisma.supportTicket.findMany as any).mockResolvedValueOnce([]);

    const from = new Date('2026-05-01T00:00:00Z');
    await supportTicketService.list({ from, page: 1, pageSize: 50 });

    const arg = (prisma.supportTicket.findMany as any).mock.calls[0][0];
    expect(arg.where).toEqual({ createdAt: { gte: from } });
  });

  it('projects assignedTo correctly when present', async () => {
    (prisma.supportTicket.count as any).mockResolvedValueOnce(1);
    (prisma.supportTicket.findMany as any).mockResolvedValueOnce([
      {
        ...sampleRow,
        status: SupportTicketStatus.RESOLVED,
        resolution: 'Resolvido',
        assignedTo: { id: 'admin-id', name: 'Ana Admin' },
      },
    ]);

    const result = await supportTicketService.list({ page: 1, pageSize: 50 });

    expect(result.data[0].assignedTo).toEqual({ id: 'admin-id', name: 'Ana Admin' });
    expect(result.data[0].resolution).toBe('Resolvido');
    expect(result.data[0].status).toBe(SupportTicketStatus.RESOLVED);
  });

  it('handles null email in user projection (User.email is optional in schema)', async () => {
    (prisma.supportTicket.count as any).mockResolvedValueOnce(1);
    (prisma.supportTicket.findMany as any).mockResolvedValueOnce([
      {
        ...sampleRow,
        user: { id: author.id, name: author.name, email: null, role: 'TENANT' },
      },
    ]);

    const result = await supportTicketService.list({ page: 1, pageSize: 50 });

    expect(result.data[0].user).toEqual({
      id: author.id,
      name: author.name,
      email: null,
      role: 'TENANT',
    });
  });
});
