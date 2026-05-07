import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VisitSource } from '@prisma/client';
import { createVisitSchema } from '../src/utils/visitValidation';
import { createVisit, getVisitById, listVisits, type VisitDeps } from '../src/services/visitService';

type FakeVisit = {
  id: string;
  propertyId: string;
  tenantId: string;
  landlordId: string;
  rentalProcessId: string | null;
  scheduledAt: Date;
  durationMinutes: number;
  status: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  source: VisitSource;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeDeps(opts: {
  properties?: Array<{ id: string; landlordId: string }>;
  visits?: FakeVisit[];
} = {}): {
  deps: VisitDeps;
  state: { visits: FakeVisit[] };
  mocks: { visitCreate: ReturnType<typeof vi.fn> };
} {
  const properties = (opts.properties ?? []).map((p) => ({ ...p }));
  const visits = (opts.visits ?? []).map((v) => ({ ...v }));

  const propertyFindUnique = vi.fn(async ({ where }: { where: { id: string } }) =>
    properties.find((p) => p.id === where.id) ?? null,
  );

  const visitFindUnique = vi.fn(async ({ where }: { where: { id: string } }) =>
    visits.find((v) => v.id === where.id) ?? null,
  );

  const visitFindMany = vi.fn(async () =>
    visits.slice().sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()),
  );

  const visitCreate = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeVisit = {
        id: `v-${visits.length + 1}`,
        propertyId: data.propertyId as string,
        tenantId: data.tenantId as string,
        landlordId: data.landlordId as string,
        rentalProcessId: (data.rentalProcessId as string | null) ?? null,
        scheduledAt: data.scheduledAt as Date,
        durationMinutes: (data.durationMinutes as number) ?? 45,
        status: ((data.status as FakeVisit['status']) ?? 'SCHEDULED'),
        source: (data.source as VisitSource) ?? VisitSource.MANUAL,
        notes: (data.notes as string | null) ?? null,
        createdAt: now,
        updatedAt: now,
      };
      visits.push(row);
      return row;
    },
  );

  const visitUpdate = vi.fn();

  return {
    deps: {
      prisma: {
        property: { findUnique: propertyFindUnique },
        visit: {
          findUnique: visitFindUnique,
          findMany: visitFindMany,
          create: visitCreate,
          update: visitUpdate,
        },
      } as unknown as VisitDeps['prisma'],
    },
    state: { visits },
    mocks: { visitCreate },
  };
}

describe('createVisitSchema — source default', () => {
  it('defaults source to MANUAL when omitted', () => {
    const parsed = createVisitSchema.parse({
      propertyId: '11111111-1111-1111-1111-111111111111',
      tenantId: '22222222-2222-2222-2222-222222222222',
      scheduledAt: '2026-05-10T14:00:00Z',
    });
    expect(parsed.source).toBe(VisitSource.MANUAL);
  });

  it('accepts explicit MANUAL', () => {
    const parsed = createVisitSchema.parse({
      propertyId: '11111111-1111-1111-1111-111111111111',
      tenantId: '22222222-2222-2222-2222-222222222222',
      scheduledAt: '2026-05-10T14:00:00Z',
      source: 'MANUAL',
    });
    expect(parsed.source).toBe(VisitSource.MANUAL);
  });

  it('accepts explicit AI', () => {
    const parsed = createVisitSchema.parse({
      propertyId: '11111111-1111-1111-1111-111111111111',
      tenantId: '22222222-2222-2222-2222-222222222222',
      scheduledAt: '2026-05-10T14:00:00Z',
      source: 'AI',
    });
    expect(parsed.source).toBe(VisitSource.AI);
  });

  it('rejects an unknown source value', () => {
    expect(() =>
      createVisitSchema.parse({
        propertyId: '11111111-1111-1111-1111-111111111111',
        tenantId: '22222222-2222-2222-2222-222222222222',
        scheduledAt: '2026-05-10T14:00:00Z',
        source: 'WHATSAPP_BOT',
      }),
    ).toThrow();
  });
});

describe('visitService.createVisit — source persistence', () => {
  it('persists MANUAL by default (no source in body)', async () => {
    const h = makeDeps({ properties: [{ id: 'prop-1', landlordId: 'landlord-1' }] });

    const parsed = createVisitSchema.parse({
      propertyId: 'prop-1',
      tenantId: 'tenant-1',
      scheduledAt: '2026-05-10T14:00:00Z',
    });
    const visit = await createVisit(parsed, h.deps);

    expect(visit.source).toBe(VisitSource.MANUAL);
    expect(h.mocks.visitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: VisitSource.MANUAL }),
      }),
    );
  });

  it('persists AI when caller passes source=AI', async () => {
    const h = makeDeps({ properties: [{ id: 'prop-1', landlordId: 'landlord-1' }] });

    const parsed = createVisitSchema.parse({
      propertyId: 'prop-1',
      tenantId: 'tenant-1',
      scheduledAt: '2026-05-10T14:00:00Z',
      source: 'AI',
    });
    const visit = await createVisit(parsed, h.deps);

    expect(visit.source).toBe(VisitSource.AI);
    expect(h.mocks.visitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: VisitSource.AI }),
      }),
    );
  });
});

describe('visitService read paths expose source', () => {
  const fixture: FakeVisit = {
    id: 'v-1',
    propertyId: 'prop-1',
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    rentalProcessId: null,
    scheduledAt: new Date('2026-05-10T14:00:00Z'),
    durationMinutes: 45,
    status: 'SCHEDULED',
    source: VisitSource.AI,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('getVisitById returns the source field', async () => {
    const h = makeDeps({ visits: [fixture] });
    const v = await getVisitById('v-1', h.deps);
    expect(v?.source).toBe(VisitSource.AI);
  });

  it('listVisits returns rows carrying the source field', async () => {
    const h = makeDeps({
      visits: [
        fixture,
        { ...fixture, id: 'v-2', scheduledAt: new Date('2026-05-11T14:00:00Z'), source: VisitSource.MANUAL },
      ],
    });
    const rows = await listVisits({}, h.deps);
    expect(rows.map((r) => r.source)).toEqual([VisitSource.AI, VisitSource.MANUAL]);
  });
});

describe('VisitSource migration DDL', () => {
  it('creates the enum and ADD COLUMN with NOT NULL DEFAULT MANUAL', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260508030000_add_visit_source/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain(
      `CREATE TYPE "VisitSource" AS ENUM ('MANUAL', 'AI');`,
    );
    expect(sql).toContain(
      `ALTER TABLE "visits" ADD COLUMN`,
    );
    expect(sql).toContain(`"source" "VisitSource" NOT NULL DEFAULT 'MANUAL'`);
  });

  it('generated Prisma client exports VisitSource with both values', () => {
    expect(VisitSource.MANUAL).toBe('MANUAL');
    expect(VisitSource.AI).toBe('AI');
  });
});
