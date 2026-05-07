import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase env vars must be present before importing the service — the module
// graph transitively pulls in firebase init via getIO.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const LANDLORD_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const CONV_ID = '33333333-3333-3333-3333-333333333333';

const { mockEmit, mockTo, mockGetIO, mockLogger } = vi.hoisted(() => {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  return {
    mockEmit: emit,
    mockTo: to,
    mockGetIO: vi.fn().mockReturnValue({ to }),
    mockLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
});

vi.mock('../src/config/socket', () => ({
  getIO: mockGetIO,
}));

vi.mock('../src/config/logger', () => ({
  logger: mockLogger,
}));

import { conversationSocketService } from '../src/services/conversationSocketService';
import type { ConversationMessageView } from '../src/services/conversationService';

beforeEach(() => {
  mockEmit.mockClear();
  mockTo.mockClear();
  mockGetIO.mockClear();
  mockGetIO.mockReturnValue({ to: mockTo });
  mockTo.mockReturnValue({ emit: mockEmit });
  mockLogger.error.mockClear();
  mockLogger.info.mockClear();
});

const conversation = { id: CONV_ID, landlordId: LANDLORD_ID, tenantId: TENANT_ID };

const sampleMessage: ConversationMessageView = {
  id: 'msg-1',
  authorId: LANDLORD_ID,
  content: 'Olá',
  createdAt: '2026-05-07T10:00:00.000Z',
  readAt: null,
};

describe('conversationSocketService.emitNewMessage — LL-014', () => {
  it('emits conversation:new_message to BOTH participant rooms with the expected payload', () => {
    conversationSocketService.emitNewMessage(conversation, sampleMessage);

    expect(mockTo).toHaveBeenCalledTimes(2);
    expect(mockTo).toHaveBeenNthCalledWith(1, `user:${LANDLORD_ID}`);
    expect(mockTo).toHaveBeenNthCalledWith(2, `user:${TENANT_ID}`);

    const expectedPayload = { conversationId: CONV_ID, message: sampleMessage };
    expect(mockEmit).toHaveBeenCalledTimes(2);
    expect(mockEmit).toHaveBeenNthCalledWith(1, 'conversation:new_message', expectedPayload);
    expect(mockEmit).toHaveBeenNthCalledWith(2, 'conversation:new_message', expectedPayload);
  });

  it('does NOT fan out to provider:all (admins are not party to user-to-user threads)', () => {
    conversationSocketService.emitNewMessage(conversation, sampleMessage);

    for (const call of mockTo.mock.calls) {
      expect(call[0]).not.toBe('provider:all');
    }
  });

  it('swallows getIO failures and logs via logger.error without propagating', () => {
    mockGetIO.mockImplementationOnce(() => {
      throw new Error('io not initialised');
    });

    expect(() =>
      conversationSocketService.emitNewMessage(conversation, sampleMessage),
    ).not.toThrow();

    // The first getIO throws — landlord emit failed. Tenant emit still happens
    // (each safeEmit call is its own try/catch).
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        room: `user:${LANDLORD_ID}`,
        event: 'conversation:new_message',
        conversationId: CONV_ID,
      }),
      '[conversationSocket] emit failed',
    );
  });
});

describe('conversationSocketService.emitMessagesRead — LL-014', () => {
  it('emits conversation:message_read ONLY to the OTHER participant (tenant read → landlord room)', () => {
    conversationSocketService.emitMessagesRead(conversation, TENANT_ID, ['m-1', 'm-2']);

    expect(mockTo).toHaveBeenCalledTimes(1);
    expect(mockTo).toHaveBeenCalledWith(`user:${LANDLORD_ID}`);
    expect(mockEmit).toHaveBeenCalledWith('conversation:message_read', {
      conversationId: CONV_ID,
      messageIds: ['m-1', 'm-2'],
    });
  });

  it('landlord read → tenant room (symmetry)', () => {
    conversationSocketService.emitMessagesRead(conversation, LANDLORD_ID, ['m-3']);

    expect(mockTo).toHaveBeenCalledTimes(1);
    expect(mockTo).toHaveBeenCalledWith(`user:${TENANT_ID}`);
    expect(mockEmit).toHaveBeenCalledWith('conversation:message_read', {
      conversationId: CONV_ID,
      messageIds: ['m-3'],
    });
  });

  it('no-op when messageIds is empty (no emit, no room lookup, no log)', () => {
    conversationSocketService.emitMessagesRead(conversation, TENANT_ID, []);

    expect(mockTo).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockGetIO).not.toHaveBeenCalled();
  });

  it('swallows getIO failures via safeEmit without throwing', () => {
    mockGetIO.mockImplementationOnce(() => {
      throw new Error('io down');
    });

    expect(() =>
      conversationSocketService.emitMessagesRead(conversation, LANDLORD_ID, ['m-x']),
    ).not.toThrow();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        room: `user:${TENANT_ID}`,
        event: 'conversation:message_read',
        readerId: LANDLORD_ID,
      }),
      '[conversationSocket] emit failed',
    );
  });
});
