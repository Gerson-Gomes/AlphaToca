import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// LL-017 — User.isIdentityVerified + User.identityVerifiedAt round-trip tests.
// The columns have no setter endpoint in this epic (admin-writable only), so
// we exercise the model contract: Prisma round-trip defaults, field presence
// in user-shaped responses (userService, propertyService.currentTenant,
// conversationService counterpart). The migration+schema shape is asserted
// against the generated Prisma client's client metadata.

vi.mock('../src/config/db', () => ({
  default: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    property: {
      findUnique: vi.fn(),
    },
    conversation: {
      findMany: vi.fn(),
    },
    conversationMessage: {
      groupBy: vi.fn(),
    },
  },
}));

import prisma from '../src/config/db';
import { userService } from '../src/services/userService';
import { propertyService } from '../src/services/propertyService';
import { conversationService } from '../src/services/conversationService';

const LANDLORD_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LL-017 — User.isIdentityVerified + identityVerifiedAt', () => {
  describe('schema migration', () => {
    it('hand-authored migration adds both columns with the correct defaults', () => {
      const sqlPath = path.join(
        __dirname,
        '..',
        'prisma',
        'migrations',
        '20260508020000_add_user_identity_verification',
        'migration.sql',
      );
      const sql = fs.readFileSync(sqlPath, 'utf8');
      expect(sql).toContain('ALTER TABLE "users"');
      expect(sql).toMatch(/ADD COLUMN\s+"is_identity_verified" BOOLEAN NOT NULL DEFAULT false/);
      expect(sql).toMatch(/ADD COLUMN\s+"identity_verified_at" TIMESTAMP\(3\)/);
      // PRD-mandated header comment (present even when soft-wrapped across --
      // comment lines; strip the leading `-- ` + newlines for a stable match).
      const stripped = sql.replace(/--\s?/g, '').replace(/\s+/g, ' ');
      expect(stripped).toContain(
        'Fields are read-only from the API surface in this epic — admin setter endpoint is a follow-up (PRD §8 Q3). Writable only via Prisma Studio / seed for now.',
      );
    });
  });

  describe('userService returns both fields (Prisma round-trip)', () => {
    it('create default → isIdentityVerified=false, identityVerifiedAt=null', async () => {
      (prisma.user.create as any).mockResolvedValue({
        id: TENANT_ID,
        name: 'Maria Silva',
        email: 'maria@example.com',
        phoneNumber: '+5511999999999',
        role: 'TENANT',
        fcmToken: null,
        firebaseUid: null,
        createdAt: new Date(),
        // Prisma defaults produced by the DB:
        isIdentityVerified: false,
        identityVerifiedAt: null,
      });

      const user = await userService.createUser({
        name: 'Maria Silva',
        email: 'maria@example.com',
        phoneNumber: '+5511999999999',
        role: 'TENANT' as any,
      });

      expect(user).toMatchObject({
        id: TENANT_ID,
        isIdentityVerified: false,
        identityVerifiedAt: null,
      });
    });

    it('findUnique after seed override returns the verified flag + timestamp', async () => {
      const verifiedAt = new Date('2026-05-01T12:00:00.000Z');
      (prisma.user.findUnique as any).mockResolvedValue({
        id: TENANT_ID,
        name: 'Maria Silva',
        email: 'maria@example.com',
        phoneNumber: '+5511999999999',
        role: 'TENANT',
        fcmToken: null,
        firebaseUid: null,
        createdAt: new Date(),
        isIdentityVerified: true,
        identityVerifiedAt: verifiedAt,
      });

      const user = await userService.getUserById(TENANT_ID);

      expect(user).not.toBeNull();
      expect(user!.isIdentityVerified).toBe(true);
      expect(user!.identityVerifiedAt).toEqual(verifiedAt);
    });
  });

  describe('propertyService.currentTenant exposes both fields (LL-017)', () => {
    it('default tenant → isIdentityVerified=false, identityVerifiedAt=null in response', async () => {
      (prisma.property.findUnique as any).mockResolvedValue({
        id: PROPERTY_ID,
        landlordId: LANDLORD_ID,
        title: 'Test',
        images: [],
        contracts: [
          {
            tenant: {
              id: TENANT_ID,
              name: 'Maria Silva',
              isIdentityVerified: false,
              identityVerifiedAt: null,
            },
          },
        ],
      });

      const result = await propertyService.getPropertyById(PROPERTY_ID);

      expect(result!.currentTenant).toEqual({
        id: TENANT_ID,
        name: 'Maria Silva',
        isIdentityVerified: false,
        identityVerifiedAt: null,
      });
    });

    it('verified tenant → both fields surface as ISO string + true (LL-017)', async () => {
      const verifiedAt = new Date('2026-04-10T09:30:00.000Z');
      (prisma.property.findUnique as any).mockResolvedValue({
        id: PROPERTY_ID,
        landlordId: LANDLORD_ID,
        title: 'Test',
        images: [],
        contracts: [
          {
            tenant: {
              id: TENANT_ID,
              name: 'Maria Silva',
              isIdentityVerified: true,
              identityVerifiedAt: verifiedAt,
            },
          },
        ],
      });

      const result = await propertyService.getPropertyById(PROPERTY_ID);

      expect(result!.currentTenant).toEqual({
        id: TENANT_ID,
        name: 'Maria Silva',
        isIdentityVerified: true,
        identityVerifiedAt: verifiedAt.toISOString(),
      });
    });

    it('findUnique include selects identity-verification fields (LL-017)', async () => {
      (prisma.property.findUnique as any).mockResolvedValue({
        id: PROPERTY_ID,
        landlordId: LANDLORD_ID,
        images: [],
        contracts: [],
      });

      await propertyService.getPropertyById(PROPERTY_ID);

      const arg = (prisma.property.findUnique as any).mock.calls[0][0];
      expect(arg.include.contracts.select.tenant.select).toEqual({
        id: true,
        name: true,
        isIdentityVerified: true,
        identityVerifiedAt: true,
      });
    });
  });

  describe('conversationService.list counterpart exposes both fields (LL-017)', () => {
    it('landlord view: counterpart is tenant → identity flags propagate', async () => {
      const verifiedAt = new Date('2026-05-03T08:00:00.000Z');
      (prisma.conversation.findMany as any).mockResolvedValue([
        {
          id: 'conv-1',
          propertyId: PROPERTY_ID,
          landlordId: LANDLORD_ID,
          tenantId: TENANT_ID,
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          landlord: {
            id: LANDLORD_ID,
            name: 'João',
            isIdentityVerified: false,
            identityVerifiedAt: null,
          },
          tenant: {
            id: TENANT_ID,
            name: 'Maria',
            isIdentityVerified: true,
            identityVerifiedAt: verifiedAt,
          },
          messages: [],
        },
      ]);
      (prisma.conversationMessage.groupBy as any).mockResolvedValue([]);

      const [summary] = await conversationService.list(LANDLORD_ID);

      expect(summary.counterpartIsIdentityVerified).toBe(true);
      expect(summary.counterpartIdentityVerifiedAt).toBe(verifiedAt.toISOString());
    });

    it('tenant view: counterpart is landlord → identity flags default to false/null', async () => {
      (prisma.conversation.findMany as any).mockResolvedValue([
        {
          id: 'conv-2',
          propertyId: PROPERTY_ID,
          landlordId: LANDLORD_ID,
          tenantId: TENANT_ID,
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          landlord: {
            id: LANDLORD_ID,
            name: 'João',
            isIdentityVerified: false,
            identityVerifiedAt: null,
          },
          tenant: {
            id: TENANT_ID,
            name: 'Maria',
            isIdentityVerified: true,
            identityVerifiedAt: new Date(),
          },
          messages: [],
        },
      ]);
      (prisma.conversationMessage.groupBy as any).mockResolvedValue([]);

      const [summary] = await conversationService.list(TENANT_ID);

      expect(summary.counterpartName).toBe('João');
      expect(summary.counterpartIsIdentityVerified).toBe(false);
      expect(summary.counterpartIdentityVerifiedAt).toBeNull();
    });

    it('findMany select covers identity-verification fields on both sides (LL-017)', async () => {
      (prisma.conversation.findMany as any).mockResolvedValue([]);

      await conversationService.list(LANDLORD_ID);

      const args = (prisma.conversation.findMany as any).mock.calls[0][0];
      expect(args.select.landlord.select).toMatchObject({
        id: true,
        name: true,
        isIdentityVerified: true,
        identityVerifiedAt: true,
      });
      expect(args.select.tenant.select).toMatchObject({
        id: true,
        name: true,
        isIdentityVerified: true,
        identityVerifiedAt: true,
      });
    });
  });
});
