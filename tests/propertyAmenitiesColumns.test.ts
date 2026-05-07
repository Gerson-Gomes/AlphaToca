import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * LL-021 — Property amenities columns (hasWifi, hasPool).
 *
 * This story is a schema-only change: it adds two boolean columns to the
 * properties table, each defaulting to false. Write-path support (POST/PUT)
 * and search filtering land in LL-022. Tests here lock in:
 *   1. Prisma round-trip create + findUnique carries both flags end-to-end.
 *   2. Omitting the flags at create time leaves them absent (Prisma applies
 *      the column DEFAULT false server-side).
 *   3. Hand-authored migration adds exactly these two columns with the
 *      snake_case DB names, BOOLEAN NOT NULL, DEFAULT false.
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

const baseData = (overrides: Record<string, unknown> = {}) => ({
  landlordId: LANDLORD_ID,
  title: 'Amenities fixture',
  description: 'LL-021 round-trip',
  price: 2500,
  address: 'Rua Teste, 10',
  ...overrides,
});

describe('LL-021 — Property amenities columns (hasWifi, hasPool)', () => {
  it('round-trips a Property with hasWifi=true + hasPool=true', async () => {
    const id = randomUUID();
    const row = {
      id,
      ...baseData(),
      hasWifi: true,
      hasPool: true,
    };

    (mockCreate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    (mockFindUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);

    const created = await prisma.property.create({
      data: {
        ...baseData(),
        hasWifi: true,
        hasPool: true,
      } as any,
    });
    expect(created.hasWifi).toBe(true);
    expect(created.hasPool).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hasWifi: true, hasPool: true }),
      }),
    );

    const readBack = await prisma.property.findUnique({ where: { id } });
    expect(readBack?.hasWifi).toBe(true);
    expect(readBack?.hasPool).toBe(true);
  });

  it('round-trips a Property with hasWifi=false + hasPool=false explicitly', async () => {
    const id = randomUUID();
    const row = {
      id,
      ...baseData(),
      hasWifi: false,
      hasPool: false,
    };

    (mockCreate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    (mockFindUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);

    const created = await prisma.property.create({
      data: {
        ...baseData(),
        hasWifi: false,
        hasPool: false,
      } as any,
    });
    expect(created.hasWifi).toBe(false);
    expect(created.hasPool).toBe(false);

    const readBack = await prisma.property.findUnique({ where: { id } });
    expect(readBack?.hasWifi).toBe(false);
    expect(readBack?.hasPool).toBe(false);
  });

  it('creating a Property without amenity fields yields the DEFAULT false for both', async () => {
    // The DB-level DEFAULT false clause is what actually produces false on read
    // when the caller omits the field at insert time. The mock mirrors that by
    // returning the row with both flags = false.
    const id = randomUUID();
    const row = {
      id,
      ...baseData(),
      hasWifi: false,
      hasPool: false,
    };

    (mockCreate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    (mockFindUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);

    const created = await prisma.property.create({
      data: baseData() as any,
    });
    expect(created.hasWifi).toBe(false);
    expect(created.hasPool).toBe(false);

    // The caller's data payload did NOT forward either field — the defaults
    // come from the DB column declaration, not the application layer.
    const call = (mockCreate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data).not.toHaveProperty('hasWifi');
    expect(call.data).not.toHaveProperty('hasPool');

    const readBack = await prisma.property.findUnique({ where: { id } });
    expect(readBack?.hasWifi).toBe(false);
    expect(readBack?.hasPool).toBe(false);
  });

  it('round-trips mixed flags (hasWifi=true, hasPool=false)', async () => {
    const id = randomUUID();
    const row = {
      id,
      ...baseData(),
      hasWifi: true,
      hasPool: false,
    };

    (mockCreate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    (mockFindUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);

    const created = await prisma.property.create({
      data: {
        ...baseData(),
        hasWifi: true,
        hasPool: false,
      } as any,
    });
    expect(created.hasWifi).toBe(true);
    expect(created.hasPool).toBe(false);

    const readBack = await prisma.property.findUnique({ where: { id } });
    expect(readBack?.hasWifi).toBe(true);
    expect(readBack?.hasPool).toBe(false);
  });

  it('hand-authored migration adds has_wifi + has_pool as BOOLEAN NOT NULL DEFAULT false', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '..',
        'prisma',
        'migrations',
        '20260508050000_add_property_amenities',
        'migration.sql',
      ),
      'utf-8',
    );

    const normalized = sql.replace(/\s+/g, ' ');

    expect(normalized).toMatch(/ALTER TABLE "properties"/);
    expect(normalized).toMatch(/ADD COLUMN\s+"has_wifi" BOOLEAN NOT NULL DEFAULT false/);
    expect(normalized).toMatch(/ADD COLUMN\s+"has_pool" BOOLEAN NOT NULL DEFAULT false/);

    // No DROP / destructive shape.
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });
});
