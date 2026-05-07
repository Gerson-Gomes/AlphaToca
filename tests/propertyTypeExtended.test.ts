import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PropertyType } from '@prisma/client';

/**
 * LL-019 — PropertyType enum +4 values (KITNET, PENTHOUSE, LAND, COMMERCIAL).
 *
 * This story is a schema-only change: it extends the PropertyType enum with
 * four additional values and ships the migration. No controller / service /
 * Zod edits are required because propertyValidation.ts uses
 * z.nativeEnum(PropertyType) — `prisma generate` is sufficient to surface
 * the new members at the validation layer.
 *
 * Tests cover:
 *   1. Generated @prisma/client exports all 8 values on PropertyType.
 *   2. Prisma round-trip: create + findUnique for each of the 4 new types
 *      (mocked driver — we do not touch the live DB).
 *   3. Migration SQL uses ALTER TYPE ADD VALUE for each new value so the
 *      existing rows' enum binding remains intact.
 *   4. Zod `z.nativeEnum(PropertyType)` accepts the 4 new values at the
 *      create-property schema layer.
 */

const LANDLORD_ID = '11111111-1111-1111-1111-111111111111';

const { mockCreate, mockFindUnique } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock('../src/config/db', () => ({
  default: {
    property: {
      create: mockCreate,
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock('../src/config/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import prisma from '../src/config/db';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LL-019 — PropertyType enum extended values', () => {
  it('generated @prisma/client exports all 8 PropertyType values', () => {
    // Plain-object enum from the generated client. This failing means
    // `prisma generate` was not re-run after the schema edit.
    expect(PropertyType).toMatchObject({
      APARTMENT: 'APARTMENT',
      HOUSE: 'HOUSE',
      STUDIO: 'STUDIO',
      CONDO_HOUSE: 'CONDO_HOUSE',
      KITNET: 'KITNET',
      PENTHOUSE: 'PENTHOUSE',
      LAND: 'LAND',
      COMMERCIAL: 'COMMERCIAL',
    });
    expect(Object.values(PropertyType)).toHaveLength(8);
  });

  it.each([
    PropertyType.KITNET,
    PropertyType.PENTHOUSE,
    PropertyType.LAND,
    PropertyType.COMMERCIAL,
  ])('round-trips a Property with type=%s via prisma.property.create + findUnique', async (type) => {
    const propertyId = randomUUID();
    const record = {
      id: propertyId,
      landlordId: LANDLORD_ID,
      title: `Test ${type}`,
      description: 'Enum extension round-trip fixture',
      price: 2500,
      address: 'Rua Teste, 10',
      type,
      status: 'AVAILABLE',
      bedrooms: 0,
      bathrooms: 0,
    };

    (mockCreate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(record);
    (mockFindUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(record);

    const created = await prisma.property.create({
      data: {
        landlordId: LANDLORD_ID,
        title: `Test ${type}`,
        description: 'Enum extension round-trip fixture',
        price: 2500,
        address: 'Rua Teste, 10',
        type,
      } as any,
    });
    expect(created.type).toBe(type);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type }) }),
    );

    const readBack = await prisma.property.findUnique({ where: { id: propertyId } });
    expect(readBack?.type).toBe(type);
  });

  it('hand-authored migration uses ALTER TYPE ADD VALUE for each new value', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '..',
        'prisma',
        'migrations',
        '20260508040000_add_property_type_extended_values',
        'migration.sql',
      ),
      'utf-8',
    );

    expect(sql).toContain(`ALTER TYPE "PropertyType" ADD VALUE 'KITNET'`);
    expect(sql).toContain(`ALTER TYPE "PropertyType" ADD VALUE 'PENTHOUSE'`);
    expect(sql).toContain(`ALTER TYPE "PropertyType" ADD VALUE 'LAND'`);
    expect(sql).toContain(`ALTER TYPE "PropertyType" ADD VALUE 'COMMERCIAL'`);

    // Must NOT drop/recreate the enum — existing rows' bindings must survive.
    expect(sql).not.toMatch(/DROP TYPE\s+"PropertyType"/i);
    expect(sql).not.toMatch(/CREATE TYPE\s+"PropertyType"/i);
  });

  it('Zod createPropertySchema via z.nativeEnum accepts each new value', async () => {
    const { createPropertySchema } = await import('../src/utils/propertyValidation');

    for (const type of [
      PropertyType.KITNET,
      PropertyType.PENTHOUSE,
      PropertyType.LAND,
      PropertyType.COMMERCIAL,
    ]) {
      const parsed = createPropertySchema.parse({
        landlordId: LANDLORD_ID,
        title: `Test ${type}`,
        description: 'Schema round-trip for the new enum values',
        price: 2500,
        address: 'Rua Teste, 10',
        type,
      });
      expect(parsed.type).toBe(type);
    }

    // Sanity: an unknown value still fails.
    expect(() =>
      createPropertySchema.parse({
        landlordId: LANDLORD_ID,
        title: 'Invalid',
        description: 'Should be rejected',
        price: 2500,
        address: 'Rua Teste, 10',
        type: 'TREE_HOUSE',
      }),
    ).toThrow();
  });
});
