import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

import prisma from '../src/config/db';
import { analyticsService } from '../src/services/analyticsService';

const mockQueryRaw = (prisma.$queryRaw as any) as ReturnType<typeof vi.fn>;

const LANDLORD_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

// `$queryRaw` is called three times per invocation in a fixed order:
// 1. rentals (COUNT contracts by start_date month)
// 2. newTenants (COUNT distinct tenants whose MIN(start_date) falls in month)
// 3. monthlyRevenue (SUM rental_payments.amount where status='PAID')
function queueQueryRaw(
  rentals: Array<{ period: string; count: number | bigint }>,
  newTenants: Array<{ period: string; count: number | bigint }>,
  revenue: Array<{ period: string; revenue: number | string | null }>,
) {
  mockQueryRaw
    .mockResolvedValueOnce(rentals)
    .mockResolvedValueOnce(newTenants)
    .mockResolvedValueOnce(revenue);
}

describe('analyticsService.monthlySeries() — LL-004', () => {
  it('returns four parallel arrays covering the inclusive month range', async () => {
    queueQueryRaw(
      [
        { period: '2026-03', count: 2n },
        { period: '2026-04', count: 1n },
        { period: '2026-05', count: 4n },
      ],
      [
        { period: '2026-03', count: 1n },
        { period: '2026-04', count: 1n },
        { period: '2026-05', count: 3n },
      ],
      [
        { period: '2026-03', revenue: '6400.00' },
        { period: '2026-04', revenue: '3200.00' },
        { period: '2026-05', revenue: '12800.00' },
      ],
    );

    const result = await analyticsService.monthlySeries(
      LANDLORD_ID,
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-05-31T23:59:59Z'),
    );

    expect(result.months).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(result.rentals).toEqual([2, 1, 4]);
    expect(result.newTenants).toEqual([1, 1, 3]);
    expect(result.monthlyRevenue).toEqual([6400, 3200, 12800]);

    expect(result.months.length).toBe(result.rentals.length);
    expect(result.months.length).toBe(result.newTenants.length);
    expect(result.months.length).toBe(result.monthlyRevenue.length);
  });

  it('zero-fills months that have no data in any of the three queries', async () => {
    // April has no contracts, no new tenants, and no paid revenue.
    queueQueryRaw(
      [
        { period: '2026-03', count: 2n },
        { period: '2026-05', count: 1n },
      ],
      [
        { period: '2026-03', count: 2n },
        { period: '2026-05', count: 1n },
      ],
      [
        { period: '2026-03', revenue: '5000.00' },
        { period: '2026-05', revenue: '2500.00' },
      ],
    );

    const result = await analyticsService.monthlySeries(
      LANDLORD_ID,
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-05-01T00:00:00Z'),
    );

    expect(result.months).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(result.rentals).toEqual([2, 0, 1]);
    expect(result.newTenants).toEqual([2, 0, 1]);
    expect(result.monthlyRevenue).toEqual([5000, 0, 2500]);
  });

  it('returns fully zero-filled arrays when the range has no matching rows at all', async () => {
    queueQueryRaw([], [], []);

    const result = await analyticsService.monthlySeries(
      LANDLORD_ID,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-15T00:00:00Z'),
    );

    expect(result.months).toEqual(['2026-01', '2026-02']);
    expect(result.rentals).toEqual([0, 0]);
    expect(result.newTenants).toEqual([0, 0]);
    expect(result.monthlyRevenue).toEqual([0, 0]);
  });

  it('spans year boundaries correctly (Nov 2025 → Feb 2026 = 4 months)', async () => {
    queueQueryRaw(
      [{ period: '2025-12', count: 1n }],
      [{ period: '2026-01', count: 1n }],
      [{ period: '2026-02', revenue: '1500.00' }],
    );

    const result = await analyticsService.monthlySeries(
      LANDLORD_ID,
      new Date('2025-11-15T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
    );

    expect(result.months).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(result.rentals).toEqual([0, 1, 0, 0]);
    expect(result.newTenants).toEqual([0, 0, 1, 0]);
    expect(result.monthlyRevenue).toEqual([0, 0, 0, 1500]);
  });

  it('handles single-month range (from and to in same month)', async () => {
    queueQueryRaw(
      [{ period: '2026-05', count: 3n }],
      [{ period: '2026-05', count: 2n }],
      [{ period: '2026-05', revenue: 9600 }],
    );

    const result = await analyticsService.monthlySeries(
      LANDLORD_ID,
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-05-31T23:59:59Z'),
    );

    expect(result.months).toEqual(['2026-05']);
    expect(result.rentals).toEqual([3]);
    expect(result.newTenants).toEqual([2]);
    expect(result.monthlyRevenue).toEqual([9600]);
  });

  it('returns empty arrays without issuing queries when from > to', async () => {
    const result = await analyticsService.monthlySeries(
      LANDLORD_ID,
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-03-01T00:00:00Z'),
    );

    expect(result.months).toEqual([]);
    expect(result.rentals).toEqual([]);
    expect(result.newTenants).toEqual([]);
    expect(result.monthlyRevenue).toEqual([]);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('coerces null COALESCE result to 0 in the revenue bucket', async () => {
    queueQueryRaw(
      [],
      [],
      [{ period: '2026-05', revenue: null }],
    );

    const result = await analyticsService.monthlySeries(
      LANDLORD_ID,
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-05-31T00:00:00Z'),
    );

    expect(result.monthlyRevenue).toEqual([0]);
  });
});
