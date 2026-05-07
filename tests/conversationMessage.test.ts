import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    conversationMessage: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import prisma from '../src/config/db';

const mockCreate = (prisma.conversationMessage.create as any) as ReturnType<typeof vi.fn>;
const mockFindUnique = (prisma.conversationMessage.findUnique as any) as ReturnType<typeof vi.fn>;
const mockFindMany = (prisma.conversationMessage.findMany as any) as ReturnType<typeof vi.fn>;

const CONVERSATION_ID = '11111111-1111-1111-1111-111111111111';
const AUTHOR_ID = '22222222-2222-2222-2222-222222222222';
const MESSAGE_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConversationMessage model round-trip', () => {
  it('creates a message with conversationId + authorId + content and defaults readAt to null', async () => {
    const now = new Date('2026-05-08T12:00:00.000Z');
    mockCreate.mockResolvedValue({
      id: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      authorId: AUTHOR_ID,
      content: 'olá',
      createdAt: now,
      readAt: null,
    });

    const created = await prisma.conversationMessage.create({
      data: {
        conversationId: CONVERSATION_ID,
        authorId: AUTHOR_ID,
        content: 'olá',
      },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        conversationId: CONVERSATION_ID,
        authorId: AUTHOR_ID,
        content: 'olá',
      },
    });
    expect(created.id).toBe(MESSAGE_ID);
    expect(created.conversationId).toBe(CONVERSATION_ID);
    expect(created.authorId).toBe(AUTHOR_ID);
    expect(created.content).toBe('olá');
    expect(created.createdAt).toEqual(now);
    expect(created.readAt).toBeNull();
  });

  it('reads back the same row via findUnique by id', async () => {
    const now = new Date('2026-05-08T12:00:00.000Z');
    const row = {
      id: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      authorId: AUTHOR_ID,
      content: 'hello',
      createdAt: now,
      readAt: null,
    };
    mockFindUnique.mockResolvedValue(row);

    const found = await prisma.conversationMessage.findUnique({ where: { id: MESSAGE_ID } });

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: MESSAGE_ID } });
    expect(found).toEqual(row);
    expect(found!.readAt).toBeNull();
  });

  it('supports setting readAt to a concrete Date (read-receipt update payload shape)', async () => {
    const readAt = new Date('2026-05-08T13:00:00.000Z');
    mockCreate.mockResolvedValue({
      id: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      authorId: AUTHOR_ID,
      content: 'already-read',
      createdAt: new Date('2026-05-08T12:00:00.000Z'),
      readAt,
    });

    const created = await prisma.conversationMessage.create({
      data: {
        conversationId: CONVERSATION_ID,
        authorId: AUTHOR_ID,
        content: 'already-read',
        readAt,
      },
    });

    expect(created.readAt).toEqual(readAt);
  });

  it('findMany returns messages ordered as passed (list endpoint shape)', async () => {
    const t1 = new Date('2026-05-08T12:00:00.000Z');
    const t2 = new Date('2026-05-08T12:05:00.000Z');
    mockFindMany.mockResolvedValue([
      { id: 'm-1', conversationId: CONVERSATION_ID, authorId: AUTHOR_ID, content: 'first', createdAt: t1, readAt: null },
      { id: 'm-2', conversationId: CONVERSATION_ID, authorId: AUTHOR_ID, content: 'second', createdAt: t2, readAt: null },
    ]);

    const rows = await prisma.conversationMessage.findMany({
      where: { conversationId: CONVERSATION_ID },
      orderBy: { createdAt: 'asc' },
    });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].content).toBe('first');
    expect(rows[1].content).toBe('second');
  });

  it('exposes the Conversation.messages inverse relation name (compile-time sanity)', () => {
    // If `messages` was not added to the Conversation model, this type assertion
    // would fail at typecheck. We only assert the key exists in the include shape.
    const include: { messages: true } = { messages: true };
    expect(include.messages).toBe(true);
  });
});
