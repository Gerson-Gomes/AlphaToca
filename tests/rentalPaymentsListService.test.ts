import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    contract: {
      findMany: vi.fn(),
    },
    rentalPayment: {
      findMany: vi.fn(),
    },
  },
}));

import prisma from '../src/config/db';
import { rentalPaymentService } from '../src/services/rentalPaymentService';

const mockContractFindMany = (prisma.contract.findMany as any) as ReturnType<typeof vi.fn>;
const mockRentalFindMany = (prisma.rentalPayment.findMany as any) as ReturnType<typeof vi.fn>;

const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rentalPaymentService.listByTenant() — LL-009', () => {
  it('returns [] when the tenant has no contracts on the property (no rentalPayment query issued)', async () => {
    mockContractFindMany.mockResolvedValue([]);

    const result = await rentalPaymentService.listByTenant(PROPERTY_ID, TENANT_ID);

    expect(result).toEqual([]);
    expect(mockContractFindMany).toHaveBeenCalledWith({
      where: { propertyId: PROPERTY_ID, tenantId: TENANT_ID },
      select: { startDate: true, endDate: true },
    });
    expect(mockRentalFindMany).not.toHaveBeenCalled();
  });

  it('happy path: 3 periods inside the contract window, ordered period DESC, PAID carries paidAt', async () => {
    // Single contract Mar..May 2026 → valid periods {2026-03, 2026-04, 2026-05}.
    mockContractFindMany.mockResolvedValue([
      {
        startDate: new Date('2026-03-01T00:00:00Z'),
        endDate: new Date('2026-05-31T23:59:59Z'),
      },
    ]);
    const paid1 = new Date('2026-05-05T10:00:00Z');
    const paid2 = new Date('2026-04-04T09:00:00Z');
    mockRentalFindMany.mockResolvedValue([
      { period: '2026-05', amount: '3200.00', status: 'PAID', updatedAt: paid1 },
      { period: '2026-04', amount: '3200.00', status: 'PAID', updatedAt: paid2 },
      {
        period: '2026-03',
        amount: '3200.00',
        status: 'AWAITING',
        updatedAt: new Date('2026-03-02T00:00:00Z'),
      },
    ]);

    const result = await rentalPaymentService.listByTenant(PROPERTY_ID, TENANT_ID);

    expect(result).toEqual([
      { period: '2026-05', amount: 3200, status: 'PAID', paidAt: paid1.toISOString() },
      { period: '2026-04', amount: 3200, status: 'PAID', paidAt: paid2.toISOString() },
      { period: '2026-03', amount: 3200, status: 'AWAITING', paidAt: null },
    ]);

    // Confirm the rentalPayment lookup uses the tenure-derived period set.
    const call = mockRentalFindMany.mock.calls[0][0];
    expect(call.where.propertyId).toBe(PROPERTY_ID);
    expect(call.where.period.in).toEqual(
      expect.arrayContaining(['2026-03', '2026-04', '2026-05']),
    );
    expect(call.where.period.in).toHaveLength(3);
    expect(call.orderBy).toEqual({ period: 'desc' });
  });

  it('excludes prior-tenant months: only periods within THIS tenant\'s contract window appear', async () => {
    // This tenant\'s contract is Mar..May 2026. Even if rental_payments has
    // rows for 2026-01/2026-02 (from a prior tenant), those must NOT appear.
    mockContractFindMany.mockResolvedValue([
      {
        startDate: new Date('2026-03-01T00:00:00Z'),
        endDate: new Date('2026-05-31T23:59:59Z'),
      },
    ]);
    // The service should have requested only Mar..May periods via `period: { in }`.
    // The mock mimics Postgres correctly: only rows matching the `in` list come back.
    mockRentalFindMany.mockImplementation((args: any) => {
      const wanted = new Set<string>(args.where.period.in);
      const all = [
        // prior tenant — must be filtered away by the `in` clause
        {
          period: '2026-01',
          amount: '2900.00',
          status: 'PAID',
          updatedAt: new Date('2026-01-05T10:00:00Z'),
        },
        {
          period: '2026-02',
          amount: '2900.00',
          status: 'PAID',
          updatedAt: new Date('2026-02-05T10:00:00Z'),
        },
        // current tenant tenure
        {
          period: '2026-05',
          amount: '3200.00',
          status: 'PAID',
          updatedAt: new Date('2026-05-05T10:00:00Z'),
        },
        {
          period: '2026-04',
          amount: '3200.00',
          status: 'PAID',
          updatedAt: new Date('2026-04-04T09:00:00Z'),
        },
        {
          period: '2026-03',
          amount: '3200.00',
          status: 'AWAITING',
          updatedAt: new Date('2026-03-02T00:00:00Z'),
        },
      ];
      return Promise.resolve(
        all
          .filter((r) => wanted.has(r.period))
          .sort((a, b) => b.period.localeCompare(a.period)),
      );
    });

    const result = await rentalPaymentService.listByTenant(PROPERTY_ID, TENANT_ID);

    expect(result.map((r) => r.period)).toEqual(['2026-05', '2026-04', '2026-03']);
    // Crucial: prior-tenant months are absent.
    expect(result.find((r) => r.period === '2026-01')).toBeUndefined();
    expect(result.find((r) => r.period === '2026-02')).toBeUndefined();
  });

  it('multiple contracts (e.g. tenant left and returned): union of their windows is used', async () => {
    // Tenant had Jan..Feb 2026 then a second stint Apr..Apr 2026 — March is a gap.
    mockContractFindMany.mockResolvedValue([
      {
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-02-28T23:59:59Z'),
      },
      {
        startDate: new Date('2026-04-01T00:00:00Z'),
        endDate: new Date('2026-04-30T23:59:59Z'),
      },
    ]);
    mockRentalFindMany.mockResolvedValue([]);

    await rentalPaymentService.listByTenant(PROPERTY_ID, TENANT_ID);

    const call = mockRentalFindMany.mock.calls[0][0];
    const periods = call.where.period.in.sort();
    expect(periods).toEqual(['2026-01', '2026-02', '2026-04']);
    // March is intentionally absent — no overlap with either contract.
    expect(periods).not.toContain('2026-03');
  });

  it('year-crossing contract enumerates months across the boundary', async () => {
    mockContractFindMany.mockResolvedValue([
      {
        startDate: new Date('2025-11-01T00:00:00Z'),
        endDate: new Date('2026-02-28T23:59:59Z'),
      },
    ]);
    mockRentalFindMany.mockResolvedValue([]);

    await rentalPaymentService.listByTenant(PROPERTY_ID, TENANT_ID);

    const call = mockRentalFindMany.mock.calls[0][0];
    const periods = call.where.period.in.sort();
    expect(periods).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('rows with null amount are surfaced as 0 (backfill gap)', async () => {
    mockContractFindMany.mockResolvedValue([
      {
        startDate: new Date('2026-05-01T00:00:00Z'),
        endDate: new Date('2026-05-31T23:59:59Z'),
      },
    ]);
    mockRentalFindMany.mockResolvedValue([
      {
        period: '2026-05',
        amount: null,
        status: 'LATE',
        updatedAt: new Date('2026-05-20T00:00:00Z'),
      },
    ]);

    const result = await rentalPaymentService.listByTenant(PROPERTY_ID, TENANT_ID);

    expect(result).toEqual([
      { period: '2026-05', amount: 0, status: 'LATE', paidAt: null },
    ]);
  });

  it('paidAt is null for non-PAID statuses even when updatedAt exists on the row', async () => {
    mockContractFindMany.mockResolvedValue([
      {
        startDate: new Date('2026-05-01T00:00:00Z'),
        endDate: new Date('2026-05-31T23:59:59Z'),
      },
    ]);
    mockRentalFindMany.mockResolvedValue([
      {
        period: '2026-05',
        amount: '3200.00',
        status: 'LATE',
        updatedAt: new Date('2026-05-10T08:00:00Z'),
      },
      {
        period: '2026-05',
        amount: '3200.00',
        status: 'AWAITING',
        updatedAt: new Date('2026-05-02T08:00:00Z'),
      },
    ]);

    const result = await rentalPaymentService.listByTenant(PROPERTY_ID, TENANT_ID);

    expect(result.every((r) => r.paidAt === null)).toBe(true);
  });
});
