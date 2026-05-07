import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    conversationMessage: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import prisma from '../src/config/db';
import { conversationService } from '../src/services/conversationService';

const mockFindUnique = (prisma.conversationMessage.findUnique as any) as ReturnType<typeof vi.fn>;
const mockFindMany = (prisma.conversationMessage.findMany as any) as ReturnType<typeof vi.fn>;
const mockUpdateMany = (prisma.conversationMessage.updateMany as any) as ReturnType<typeof vi.fn>;

const CONV_ID = '11111111-1111-1111-1111-111111111111';
const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('conversationService.listMessages — LL-012', () => {
  it('no before: returns latest `limit` items in ASC order; updateMany skipped when nothing to mark', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'm-2',
        authorId: LANDLORD_ID,
        content: 'Olá',
        createdAt: new Date('2026-05-07T10:10:00.000Z'),
        readAt: null,
      },
      {
        id: 'm-1',
        authorId: LANDLORD_ID,
        content: 'Ping',
        createdAt: new Date('2026-05-07T10:00:00.000Z'),
        readAt: null,
      },
    ]);

    const result = await conversationService.listMessages(CONV_ID, LANDLORD_ID, 50);

    // DESC from DB then reversed to ASC.
    expect(result.messages.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(result.markedReadIds).toEqual([]);
    expect(mockUpdateMany).not.toHaveBeenCalled();

    const findManyArgs = mockFindMany.mock.calls[0][0];
    expect(findManyArgs.where).toEqual({ conversationId: CONV_ID });
    expect(findManyArgs.orderBy).toEqual({ createdAt: 'desc' });
    expect(findManyArgs.take).toBe(50);
  });

  it('marks the caller\'s unread inbound messages as read and reflects new readAt in payload', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'm-1',
        authorId: TENANT_ID, // from the OTHER participant — should be marked
        content: 'Oi',
        createdAt: new Date('2026-05-07T10:00:00.000Z'),
        readAt: null,
      },
      {
        id: 'm-2',
        authorId: LANDLORD_ID, // from the caller — NOT marked
        content: 'Olá',
        createdAt: new Date('2026-05-07T10:10:00.000Z'),
        readAt: null,
      },
      {
        id: 'm-3',
        authorId: TENANT_ID,
        content: 'Respondeu?',
        createdAt: new Date('2026-05-07T10:20:00.000Z'),
        readAt: new Date('2026-05-07T10:21:00.000Z'), // already read — skipped
      },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const result = await conversationService.listMessages(CONV_ID, LANDLORD_ID, 50);

    expect(result.markedReadIds).toEqual(['m-1']);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdateMany.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: { in: ['m-1'] } });
    expect(updateArgs.data.readAt).toBeInstanceOf(Date);

    const byId = new Map(result.messages.map((m) => [m.id, m]));
    expect(byId.get('m-1')!.readAt).not.toBeNull(); // newly marked
    expect(byId.get('m-2')!.readAt).toBeNull(); // author is caller — untouched
    expect(byId.get('m-3')!.readAt).toBe(new Date('2026-05-07T10:21:00.000Z').toISOString());
  });

  it('with before: resolves cursor to createdAt and filters to older messages', async () => {
    const CURSOR_ID = 'cursor-msg';
    const CURSOR_CREATED = new Date('2026-05-07T10:10:00.000Z');
    mockFindUnique.mockResolvedValue({
      conversationId: CONV_ID,
      createdAt: CURSOR_CREATED,
    });
    mockFindMany.mockResolvedValue([
      {
        id: 'm-older-2',
        authorId: LANDLORD_ID,
        content: 'x',
        createdAt: new Date('2026-05-07T09:10:00.000Z'),
        readAt: null,
      },
      {
        id: 'm-older-1',
        authorId: LANDLORD_ID,
        content: 'y',
        createdAt: new Date('2026-05-07T09:00:00.000Z'),
        readAt: null,
      },
    ]);

    const result = await conversationService.listMessages(CONV_ID, LANDLORD_ID, 25, CURSOR_ID);

    expect(result.messages.map((m) => m.id)).toEqual(['m-older-1', 'm-older-2']);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: CURSOR_ID },
      select: { conversationId: true, createdAt: true },
    });
    const findManyArgs = mockFindMany.mock.calls[0][0];
    expect(findManyArgs.where).toEqual({
      conversationId: CONV_ID,
      createdAt: { lt: CURSOR_CREATED },
    });
    expect(findManyArgs.take).toBe(25);
  });

  it('with before: cursor not belonging to conversation → [] without running findMany or updateMany', async () => {
    mockFindUnique.mockResolvedValue({
      conversationId: 'other-conv',
      createdAt: new Date('2026-05-07T10:00:00.000Z'),
    });

    const result = await conversationService.listMessages(CONV_ID, LANDLORD_ID, 50, 'forged-cursor');

    expect(result).toEqual({ messages: [], markedReadIds: [] });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('with before: non-existent cursor → [] (no findMany, no updateMany)', async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await conversationService.listMessages(CONV_ID, LANDLORD_ID, 50, 'ghost-cursor');

    expect(result).toEqual({ messages: [], markedReadIds: [] });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('empty page: findMany returns [] → messages=[] and no updateMany', async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await conversationService.listMessages(CONV_ID, LANDLORD_ID, 50);

    expect(result.messages).toEqual([]);
    expect(result.markedReadIds).toEqual([]);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('tenant as caller: messages FROM landlord are marked as read, not own messages', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'm-1',
        authorId: LANDLORD_ID,
        content: 'From landlord',
        createdAt: new Date('2026-05-07T10:00:00.000Z'),
        readAt: null,
      },
      {
        id: 'm-2',
        authorId: TENANT_ID,
        content: 'From tenant',
        createdAt: new Date('2026-05-07T10:10:00.000Z'),
        readAt: null,
      },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const result = await conversationService.listMessages(CONV_ID, TENANT_ID, 50);

    expect(result.markedReadIds).toEqual(['m-1']);
    const updateArgs = mockUpdateMany.mock.calls[0][0];
    expect(updateArgs.where.id.in).toEqual(['m-1']);
  });

  it('respects custom limit in the findMany.take', async () => {
    mockFindMany.mockResolvedValue([]);

    await conversationService.listMessages(CONV_ID, LANDLORD_ID, 7);

    expect(mockFindMany.mock.calls[0][0].take).toBe(7);
  });
});
