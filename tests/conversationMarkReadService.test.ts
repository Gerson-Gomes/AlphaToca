import { describe, it, expect, vi, beforeEach } from 'vitest';

// Direct service-level unit test for LL-015. Mirrors the split used by
// conversationMessagesService.test.ts + conversationMessages.test.ts: HTTP
// tests mock the service, service tests mock prisma. Keeping them in separate
// files avoids the module-graph caching issue documented in progress.txt.

const { mockQueryRaw } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
}));

vi.mock('../src/config/db', () => ({
  default: {
    $queryRaw: mockQueryRaw,
  },
}));

import { conversationService } from '../src/services/conversationService';

const CONV_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('conversationService.markAllRead — LL-015', () => {
  it('returns the ids returned by the RETURNING clause', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ id: 'm-1' }, { id: 'm-2' }, { id: 'm-3' }]);

    const ids = await conversationService.markAllRead(CONV_ID, USER_ID);

    expect(ids).toEqual(['m-1', 'm-2', 'm-3']);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns [] when nothing is unread (update affected zero rows)', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const ids = await conversationService.markAllRead(CONV_ID, USER_ID);

    expect(ids).toEqual([]);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('parameterizes conversationId and userId as prepared-statement bindings', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    await conversationService.markAllRead(CONV_ID, USER_ID);

    const call = mockQueryRaw.mock.calls[0];
    // Prisma tagged-template call signature: (stringsArray, ...values).
    // Values are bound as prepared-statement parameters — assert both ids are
    // forwarded in the expected order (conversationId first, userId second).
    const values = call.slice(1);
    expect(values).toEqual([CONV_ID, USER_ID]);
  });

  it('issues the UPDATE ... RETURNING shape with the expected filters', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    await conversationService.markAllRead(CONV_ID, USER_ID);

    const [strings] = mockQueryRaw.mock.calls[0];
    const joined = (strings as TemplateStringsArray).join('?');
    expect(joined).toContain('UPDATE "conversation_messages"');
    expect(joined).toContain('SET "read_at" = NOW()');
    expect(joined).toContain('"conversation_id" = ');
    expect(joined).toContain('"author_id" != ');
    expect(joined).toContain('"read_at" IS NULL');
    expect(joined).toContain('RETURNING "id"');
  });

  it('propagates DB errors (caller controller decides how to respond)', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('boom'));

    await expect(conversationService.markAllRead(CONV_ID, USER_ID)).rejects.toThrow('boom');
  });
});
