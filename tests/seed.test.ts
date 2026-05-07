import { describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { main } from '../prisma/seed';
import {
  DEMO_LANDLORD_1_ID,
  DEMO_TENANT_1_ID,
  DEMO_ADMIN_ID,
  DEMO_PROPERTY_SP_1_ID,
  DEMO_PROPERTY_RJ_1_ID,
  DEMO_PROPERTY_RJ_2_ID,
  DEMO_PROPERTY_RJ_3_ID,
  DEMO_PROPERTY_RJ_4_ID,
} from '../prisma/demoIds';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEMO_USER_IDS = new Set([DEMO_LANDLORD_1_ID, DEMO_TENANT_1_ID, DEMO_ADMIN_ID]);
const DEMO_PROPERTY_IDS = new Set([
  DEMO_PROPERTY_SP_1_ID,
  DEMO_PROPERTY_RJ_1_ID,
  DEMO_PROPERTY_RJ_2_ID,
  DEMO_PROPERTY_RJ_3_ID,
  DEMO_PROPERTY_RJ_4_ID,
]);

const { mockPrismaClient } = vi.hoisted(() => {
  return {
    mockPrismaClient: {
      user: { deleteMany: vi.fn(), createMany: vi.fn() },
      property: { deleteMany: vi.fn(), createMany: vi.fn() },
      propertyImage: { deleteMany: vi.fn(), createMany: vi.fn() },
      chatSession: { deleteMany: vi.fn(), createMany: vi.fn() },
      message: { deleteMany: vi.fn(), createMany: vi.fn() },
      knowledgeDocument: { deleteMany: vi.fn(), createMany: vi.fn(), create: vi.fn() },
      rentalDocument: { deleteMany: vi.fn().mockResolvedValue(true) },
      aiExtractedInsight: { deleteMany: vi.fn().mockResolvedValue(true) },
      rentalProcess: { deleteMany: vi.fn().mockResolvedValue(true) },
      $executeRawUnsafe: vi.fn(),
      $disconnect: vi.fn(),
    }
  };
});

vi.mock(import('@prisma/client'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    PrismaClient: class {
      constructor() {
        return mockPrismaClient;
      }
    } as unknown as typeof actual.PrismaClient,
  };
});

describe('Seeding Script', () => {
  it('should clear the database and insert new records', async () => {
    const prisma = new PrismaClient();
    await main();

    expect(prisma.message.deleteMany).toHaveBeenCalled();
    expect(prisma.chatSession.deleteMany).toHaveBeenCalled();
    expect(prisma.property.deleteMany).toHaveBeenCalled();
    expect(prisma.user.deleteMany).toHaveBeenCalled();
    expect(prisma.knowledgeDocument.deleteMany).toHaveBeenCalled();

    expect(prisma.user.createMany).toHaveBeenCalled();
    expect(prisma.property.createMany).toHaveBeenCalled();
    expect(prisma.chatSession.createMany).toHaveBeenCalled();
    expect(prisma.message.createMany).toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
  });

  it('should insert users with UUID-shaped ids', async () => {
    await main();

    const userCreateManyCall = (mockPrismaClient.user.createMany as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(userCreateManyCall).toBeDefined();
    const userPayload = userCreateManyCall[0] as { data: Array<{ id: string }> };
    expect(Array.isArray(userPayload.data)).toBe(true);
    expect(userPayload.data.length).toBeGreaterThan(0);

    for (const user of userPayload.data) {
      expect(typeof user.id).toBe('string');
      const isDemoId = DEMO_USER_IDS.has(user.id);
      const matchesV4 = UUID_V4_REGEX.test(user.id);
      expect(isDemoId || matchesV4).toBe(true);
    }
  });

  it('should insert properties with UUID-shaped ids and landlordIds', async () => {
    await main();

    const propertyCreateManyCall = (
      mockPrismaClient.property.createMany as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(propertyCreateManyCall).toBeDefined();
    const propertyPayload = propertyCreateManyCall[0] as {
      data: Array<{ id: string; landlordId: string }>;
    };
    expect(Array.isArray(propertyPayload.data)).toBe(true);
    expect(propertyPayload.data.length).toBeGreaterThan(0);

    for (const property of propertyPayload.data) {
      expect(typeof property.id).toBe('string');
      expect(typeof property.landlordId).toBe('string');

      const idIsDemo = DEMO_PROPERTY_IDS.has(property.id);
      const idMatchesV4 = UUID_V4_REGEX.test(property.id);
      expect(idIsDemo || idMatchesV4).toBe(true);

      const landlordIsDemo = DEMO_USER_IDS.has(property.landlordId);
      const landlordMatchesV4 = UUID_V4_REGEX.test(property.landlordId);
      expect(landlordIsDemo || landlordMatchesV4).toBe(true);
    }
  });
});
