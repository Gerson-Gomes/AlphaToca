import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    conversation: {
      findMany: vi.fn(),
    },
    conversationMessage: {
      groupBy: vi.fn(),
    },
  },
}));

import prisma from '../src/config/db';
import { conversationService } from '../src/services/conversationService';

const mockFindMany = (prisma.conversation.findMany as any) as ReturnType<typeof vi.fn>;
const mockGroupBy = (prisma.conversationMessage.groupBy as any) as ReturnType<typeof vi.fn>;

const LANDLORD_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_A = '22222222-2222-2222-2222-222222222222';
const TENANT_ID_B = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
});

function convRow(overrides: Partial<any> = {}) {
  return {
    id: 'conv-1',
    propertyId: 'prop-1',
    landlordId: LANDLORD_ID,
    tenantId: TENANT_ID_A,
    createdAt: new Date('2026-05-01T10:00:00.000Z'),
    landlord: {
      id: LANDLORD_ID,
      name: 'João Locador',
      isIdentityVerified: false,
      identityVerifiedAt: null,
    },
    tenant: {
      id: TENANT_ID_A,
      name: 'Maria Silva',
      isIdentityVerified: false,
      identityVerifiedAt: null,
    },
    messages: [],
    ...overrides,
  };
}

describe('conversationService.list — LL-011', () => {
  it('returns empty array when user has no conversations without issuing the groupBy', async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await conversationService.list(LANDLORD_ID);

    expect(result).toEqual([]);
    expect(mockGroupBy).not.toHaveBeenCalled();
    const args = mockFindMany.mock.calls[0][0];
    expect(args.where).toEqual({
      OR: [{ landlordId: LANDLORD_ID }, { tenantId: LANDLORD_ID }],
    });
  });

  it('landlord view: counterpartName is the tenant, linkedTenantId is the tenantId', async () => {
    mockFindMany.mockResolvedValue([
      convRow({
        id: 'c-1',
        messages: [
          { id: 'm-1', content: 'Bom dia', createdAt: new Date('2026-05-07T12:00:00.000Z') },
        ],
      }),
    ]);
    mockGroupBy.mockResolvedValue([{ conversationId: 'c-1', _count: { _all: 2 } }]);

    const [s] = await conversationService.list(LANDLORD_ID);

    expect(s).toEqual({
      id: 'c-1',
      counterpartName: 'Maria Silva',
      counterpartAvatarUrl: null,
      counterpartIsIdentityVerified: false,
      counterpartIdentityVerifiedAt: null,
      lastMessage: 'Bom dia',
      lastMessageAt: '2026-05-07T12:00:00.000Z',
      unread: true,
      linkedPropertyId: 'prop-1',
      linkedTenantId: TENANT_ID_A,
    });
  });

  it('landlord view: counterpart identity verification flags propagate (LL-017)', async () => {
    const verifiedAt = new Date('2026-04-15T08:00:00.000Z');
    mockFindMany.mockResolvedValue([
      convRow({
        id: 'c-verified',
        tenant: {
          id: TENANT_ID_A,
          name: 'Maria Silva',
          isIdentityVerified: true,
          identityVerifiedAt: verifiedAt,
        },
        messages: [
          { id: 'm-1', content: 'Oi', createdAt: new Date('2026-05-07T12:00:00.000Z') },
        ],
      }),
    ]);
    mockGroupBy.mockResolvedValue([]);

    const [s] = await conversationService.list(LANDLORD_ID);

    expect(s.counterpartIsIdentityVerified).toBe(true);
    expect(s.counterpartIdentityVerifiedAt).toBe(verifiedAt.toISOString());
  });

  it('tenant view: counterpartName is the landlord (same row, caller role flipped)', async () => {
    mockFindMany.mockResolvedValue([
      convRow({
        id: 'c-1',
        messages: [
          { id: 'm-1', content: 'Hi', createdAt: new Date('2026-05-07T12:00:00.000Z') },
        ],
      }),
    ]);
    mockGroupBy.mockResolvedValue([]);

    const [s] = await conversationService.list(TENANT_ID_A);

    expect(s.counterpartName).toBe('João Locador');
    expect(s.linkedTenantId).toBe(TENANT_ID_A);
    expect(s.unread).toBe(false);
  });

  it('conversation with no messages: lastMessage=null, lastMessageAt=conversation.createdAt', async () => {
    const createdAt = new Date('2026-05-01T10:00:00.000Z');
    mockFindMany.mockResolvedValue([convRow({ id: 'c-empty', createdAt, messages: [] })]);
    mockGroupBy.mockResolvedValue([]);

    const [s] = await conversationService.list(LANDLORD_ID);

    expect(s.lastMessage).toBeNull();
    expect(s.lastMessageAt).toBe(createdAt.toISOString());
    expect(s.unread).toBe(false);
  });

  it('unread detection: groupBy returns a row with count > 0 → unread=true; absent → false', async () => {
    mockFindMany.mockResolvedValue([
      convRow({
        id: 'c-unread',
        tenantId: TENANT_ID_A,
        tenant: { id: TENANT_ID_A, name: 'Maria' },
        messages: [
          { id: 'm-1', content: 'oi', createdAt: new Date('2026-05-07T10:00:00.000Z') },
        ],
      }),
      convRow({
        id: 'c-read',
        tenantId: TENANT_ID_B,
        tenant: { id: TENANT_ID_B, name: 'Ana' },
        messages: [
          { id: 'm-2', content: 'tchau', createdAt: new Date('2026-05-06T10:00:00.000Z') },
        ],
      }),
    ]);
    mockGroupBy.mockResolvedValue([{ conversationId: 'c-unread', _count: { _all: 1 } }]);

    const list = await conversationService.list(LANDLORD_ID);
    const byId = new Map(list.map((s) => [s.id, s]));
    expect(byId.get('c-unread')!.unread).toBe(true);
    expect(byId.get('c-read')!.unread).toBe(false);

    // groupBy was scoped to the authorId/readAt filter
    const groupByArgs = mockGroupBy.mock.calls[0][0];
    expect(groupByArgs.where).toEqual({
      conversationId: { in: ['c-unread', 'c-read'] },
      readAt: null,
      authorId: { not: LANDLORD_ID },
    });
  });

  it('unreadOnly=true drops conversations with unread=false', async () => {
    mockFindMany.mockResolvedValue([
      convRow({
        id: 'c-unread',
        tenantId: TENANT_ID_A,
        tenant: { id: TENANT_ID_A, name: 'Maria' },
        messages: [
          { id: 'm-1', content: 'oi', createdAt: new Date('2026-05-07T10:00:00.000Z') },
        ],
      }),
      convRow({
        id: 'c-read',
        tenantId: TENANT_ID_B,
        tenant: { id: TENANT_ID_B, name: 'Ana' },
        messages: [
          { id: 'm-2', content: 'tchau', createdAt: new Date('2026-05-06T10:00:00.000Z') },
        ],
      }),
    ]);
    mockGroupBy.mockResolvedValue([{ conversationId: 'c-unread', _count: { _all: 1 } }]);

    const list = await conversationService.list(LANDLORD_ID, true);

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('c-unread');
    expect(list[0].unread).toBe(true);
  });

  it('ordering: lastMessageAt DESC (newest thread first)', async () => {
    mockFindMany.mockResolvedValue([
      convRow({
        id: 'c-old',
        messages: [{ id: 'm-1', content: 'a', createdAt: new Date('2026-05-01T10:00:00.000Z') }],
      }),
      convRow({
        id: 'c-new',
        messages: [{ id: 'm-2', content: 'b', createdAt: new Date('2026-05-07T10:00:00.000Z') }],
      }),
      convRow({
        id: 'c-mid',
        messages: [{ id: 'm-3', content: 'c', createdAt: new Date('2026-05-05T10:00:00.000Z') }],
      }),
    ]);
    mockGroupBy.mockResolvedValue([]);

    const list = await conversationService.list(LANDLORD_ID);
    expect(list.map((s) => s.id)).toEqual(['c-new', 'c-mid', 'c-old']);
  });

  it('ordering: empty thread sorts by createdAt relative to other threads with messages', async () => {
    mockFindMany.mockResolvedValue([
      convRow({
        id: 'c-empty-newer',
        createdAt: new Date('2026-05-08T10:00:00.000Z'),
        messages: [],
      }),
      convRow({
        id: 'c-msg-older',
        messages: [{ id: 'm-1', content: 'x', createdAt: new Date('2026-05-01T10:00:00.000Z') }],
      }),
    ]);
    mockGroupBy.mockResolvedValue([]);

    const list = await conversationService.list(LANDLORD_ID);
    expect(list.map((s) => s.id)).toEqual(['c-empty-newer', 'c-msg-older']);
  });

  it('findMany select includes the fields the service actually reads (compile-time-ish guard via args)', async () => {
    mockFindMany.mockResolvedValue([]);

    await conversationService.list(LANDLORD_ID);

    const args = mockFindMany.mock.calls[0][0];
    // Shape sanity — if any of these keys regress, the mapper will crash at runtime.
    expect(args.select).toMatchObject({
      id: true,
      propertyId: true,
      landlordId: true,
      tenantId: true,
      createdAt: true,
      landlord: {
        select: {
          id: true,
          name: true,
          isIdentityVerified: true,
          identityVerifiedAt: true,
        },
      },
      tenant: {
        select: {
          id: true,
          name: true,
          isIdentityVerified: true,
          identityVerifiedAt: true,
        },
      },
    });
    expect(args.select.messages).toMatchObject({
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
  });
});
