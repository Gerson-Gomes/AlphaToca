import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    conversation: {
      upsert: vi.fn(),
    },
  },
}));

import prisma from '../src/config/db';
import { conversationService } from '../src/services/conversationService';

const mockUpsert = (prisma.conversation.upsert as any) as ReturnType<typeof vi.fn>;

const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';
const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const CONVERSATION_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('conversationService.resolve()', () => {
  it('upserts on the compound-unique key and returns messages: []', async () => {
    const createdAt = new Date('2026-05-07T12:00:00Z');
    mockUpsert.mockResolvedValue({
      id: CONVERSATION_ID,
      propertyId: PROPERTY_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      createdAt,
    });

    const result = await conversationService.resolve(PROPERTY_ID, LANDLORD_ID, TENANT_ID);

    expect(result).toEqual({
      id: CONVERSATION_ID,
      propertyId: PROPERTY_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      messages: [],
      createdAt: createdAt.toISOString(),
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: {
        conversations_property_landlord_tenant_key: {
          propertyId: PROPERTY_ID,
          landlordId: LANDLORD_ID,
          tenantId: TENANT_ID,
        },
      },
      create: {
        propertyId: PROPERTY_ID,
        landlordId: LANDLORD_ID,
        tenantId: TENANT_ID,
      },
      update: {},
      select: {
        id: true,
        propertyId: true,
        landlordId: true,
        tenantId: true,
        createdAt: true,
      },
    });
  });

  it('returns the same id on idempotent calls (upsert returns existing row)', async () => {
    const createdAt = new Date('2026-05-07T12:00:00Z');
    mockUpsert.mockResolvedValue({
      id: CONVERSATION_ID,
      propertyId: PROPERTY_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      createdAt,
    });

    const first = await conversationService.resolve(PROPERTY_ID, LANDLORD_ID, TENANT_ID);
    const second = await conversationService.resolve(PROPERTY_ID, LANDLORD_ID, TENANT_ID);

    expect(first.id).toBe(second.id);
    expect(first.id).toBe(CONVERSATION_ID);
    // Both calls go through upsert — service is stateless, idempotency comes
    // from the DB's unique constraint, not from any service-level caching.
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it('ISO-serializes createdAt from a Date', async () => {
    const createdAt = new Date('2026-11-15T09:30:00Z');
    mockUpsert.mockResolvedValue({
      id: CONVERSATION_ID,
      propertyId: PROPERTY_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      createdAt,
    });

    const result = await conversationService.resolve(PROPERTY_ID, LANDLORD_ID, TENANT_ID);
    expect(result.createdAt).toBe(createdAt.toISOString());
  });

  it('never mixes landlordId and tenantId in the upsert where clause', async () => {
    // Guard against a regression where the compound-unique key order gets
    // swapped: propertyId comes first, then landlordId, then tenantId.
    // Swapping landlordId/tenantId would map two legitimate threads to the
    // same row and break isolation between users.
    mockUpsert.mockResolvedValue({
      id: CONVERSATION_ID,
      propertyId: PROPERTY_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      createdAt: new Date('2026-05-07T12:00:00Z'),
    });

    await conversationService.resolve(PROPERTY_ID, LANDLORD_ID, TENANT_ID);

    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.conversations_property_landlord_tenant_key).toEqual({
      propertyId: PROPERTY_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
    });
    expect(call.create).toEqual({
      propertyId: PROPERTY_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
    });
  });

  it('handles concurrent calls for the same triple via Promise.all and returns identical views', async () => {
    const createdAt = new Date('2026-05-07T12:00:00Z');
    mockUpsert.mockResolvedValue({
      id: CONVERSATION_ID,
      propertyId: PROPERTY_ID,
      landlordId: LANDLORD_ID,
      tenantId: TENANT_ID,
      createdAt,
    });

    const [a, b] = await Promise.all([
      conversationService.resolve(PROPERTY_ID, LANDLORD_ID, TENANT_ID),
      conversationService.resolve(PROPERTY_ID, LANDLORD_ID, TENANT_ID),
    ]);

    expect(a).toEqual(b);
    expect(a.id).toBe(CONVERSATION_ID);
  });
});
