import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma BEFORE importing anything that touches propertyService — the
// service imports `prisma` at module load time.
vi.mock('../src/config/db', () => ({
  default: {
    property: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    contract: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

import prisma from '../src/config/db';
import { propertyService } from '../src/services/propertyService';

const LANDLORD_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';

// Minimal valid Property row — only the fields we exercise. extractCurrentTenant
// uses Object.rest so unknown fields pass through.
function makePropertyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPERTY_ID,
    landlordId: LANDLORD_ID,
    title: 'Test',
    description: 'Test description',
    price: 2500,
    status: 'AVAILABLE',
    address: 'Rua X, 123',
    images: [],
    ...overrides,
  };
}

describe('propertyService.getPropertyById — currentTenant (US-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns currentTenant=null when no ACTIVE contract exists for the property', async () => {
    (prisma.property.findUnique as any).mockResolvedValue(
      makePropertyRow({ contracts: [] }),
    );

    const result = await propertyService.getPropertyById(PROPERTY_ID);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty('currentTenant', null);
    // contracts should NOT leak into the response — it's the internal relation payload
    expect(result).not.toHaveProperty('contracts');
  });

  it('returns currentTenant={id,name} when an ACTIVE contract exists', async () => {
    (prisma.property.findUnique as any).mockResolvedValue(
      makePropertyRow({
        contracts: [{ tenant: { id: TENANT_ID, name: 'Maria Silva' } }],
      }),
    );

    const result = await propertyService.getPropertyById(PROPERTY_ID);

    expect(result).not.toBeNull();
    expect(result!.currentTenant).toEqual({ id: TENANT_ID, name: 'Maria Silva' });
  });

  it('returns null when the property itself is not found', async () => {
    (prisma.property.findUnique as any).mockResolvedValue(null);
    const result = await propertyService.getPropertyById(PROPERTY_ID);
    expect(result).toBeNull();
  });

  it('queries Prisma with include.contracts filtered by status=ACTIVE (no N+1)', async () => {
    (prisma.property.findUnique as any).mockResolvedValue(
      makePropertyRow({ contracts: [] }),
    );

    await propertyService.getPropertyById(PROPERTY_ID);

    expect(prisma.property.findUnique).toHaveBeenCalledTimes(1);
    const arg = (prisma.property.findUnique as any).mock.calls[0][0];
    expect(arg.where).toEqual({ id: PROPERTY_ID });
    expect(arg.include).toMatchObject({
      images: true,
      contracts: {
        where: { status: 'ACTIVE' },
        take: 1,
      },
    });
    // Tenant is selected only to { id, name } — verify no extra PII leaks
    expect(arg.include.contracts.select).toEqual({
      tenant: { select: { id: true, name: true } },
    });
  });
});

describe('propertyService.searchProperties — currentTenant per item (US-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findMany path: each item carries currentTenant (populated or null)', async () => {
    const propA = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', landlordId: LANDLORD_ID, images: [], contracts: [{ tenant: { id: TENANT_ID, name: 'Maria Silva' } }] };
    const propB = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', landlordId: LANDLORD_ID, images: [], contracts: [] };

    (prisma.property.count as any).mockResolvedValue(2);
    (prisma.property.findMany as any).mockResolvedValue([propA, propB]);

    const result = await propertyService.searchProperties({ landlordId: LANDLORD_ID, page: 1, limit: 10 } as any);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ id: propA.id, currentTenant: { id: TENANT_ID, name: 'Maria Silva' } });
    expect(result.data[1]).toMatchObject({ id: propB.id, currentTenant: null });
    // contracts must not leak into the response shape
    expect(result.data[0]).not.toHaveProperty('contracts');
    expect(result.data[1]).not.toHaveProperty('contracts');
  });

  it('findMany path: exactly 2 Prisma calls regardless of page size (no N+1)', async () => {
    // Simulate a page of 10 properties
    const manyProps = Array.from({ length: 10 }, (_, i) => ({
      id: `cccccccc-cccc-cccc-cccc-${String(i).padStart(12, '0')}`,
      landlordId: LANDLORD_ID,
      images: [],
      contracts: [],
    }));
    (prisma.property.count as any).mockResolvedValue(10);
    (prisma.property.findMany as any).mockResolvedValue(manyProps);

    await propertyService.searchProperties({ landlordId: LANDLORD_ID, page: 1, limit: 10 } as any);

    // count + findMany = 2 — unchanged by the new include. No per-item query.
    expect(prisma.property.count).toHaveBeenCalledTimes(1);
    expect(prisma.property.findMany).toHaveBeenCalledTimes(1);
    // Verify the include carries contracts selection
    const findManyArg = (prisma.property.findMany as any).mock.calls[0][0];
    expect(findManyArg.include).toMatchObject({
      contracts: { where: { status: 'ACTIVE' }, take: 1 },
    });
  });

  it('raw SQL path (geolocation): currentTenant populated via one batched contract query', async () => {
    // $queryRaw is used twice in the geo branch: once for the SELECT and once for COUNT
    const rawProps = [
      { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', landlord_id: LANDLORD_ID, distance: 0.5 },
      { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', landlord_id: LANDLORD_ID, distance: 1.2 },
    ];
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce(rawProps) // SELECT *
      .mockResolvedValueOnce([{ count: 2 }]); // COUNT

    (prisma.contract.findMany as any).mockResolvedValue([
      {
        propertyId: rawProps[0].id,
        createdAt: new Date(),
        tenant: { id: TENANT_ID, name: 'Maria Silva' },
      },
    ]);

    const result = await propertyService.searchProperties({
      landlordId: LANDLORD_ID,
      lat: -23.5,
      lng: -46.6,
      page: 1,
      limit: 10,
    } as any);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      id: rawProps[0].id,
      currentTenant: { id: TENANT_ID, name: 'Maria Silva' },
    });
    expect(result.data[1]).toMatchObject({
      id: rawProps[1].id,
      currentTenant: null,
    });
    // Exactly one batched contract.findMany — independent of result count
    expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
    const arg = (prisma.contract.findMany as any).mock.calls[0][0];
    expect(arg.where).toMatchObject({
      status: 'ACTIVE',
      propertyId: { in: [rawProps[0].id, rawProps[1].id] },
    });
  });

  it('raw SQL path: skips the contract query entirely when no properties are returned', async () => {
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([]) // no properties
      .mockResolvedValueOnce([{ count: 0 }]);

    const result = await propertyService.searchProperties({
      landlordId: LANDLORD_ID,
      lat: -23.5,
      lng: -46.6,
      page: 1,
      limit: 10,
    } as any);

    expect(result.data).toEqual([]);
    expect(prisma.contract.findMany).not.toHaveBeenCalled();
  });
});
