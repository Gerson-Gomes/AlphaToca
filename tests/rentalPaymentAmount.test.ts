import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    rentalPayment: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    contract: {
      findFirst: vi.fn(),
    },
  },
}));

import prisma from '../src/config/db';
import { rentalPaymentService } from '../src/services/rentalPaymentService';

const mockFindUnique = (prisma.rentalPayment.findUnique as any) as ReturnType<typeof vi.fn>;
const mockUpsert = (prisma.rentalPayment.upsert as any) as ReturnType<typeof vi.fn>;
const mockContractFindFirst = (prisma.contract.findFirst as any) as ReturnType<typeof vi.fn>;

const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';
const LANDLORD_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LL-003 — RentalPayment.amount roundtrip', () => {
  it('on upsertCurrent, snapshots amount from the ACTIVE contract.monthlyRent and reads it back', async () => {
    // Active contract at write-time returns a 3200 BRL rent.
    mockContractFindFirst.mockResolvedValue({ monthlyRent: '3200.00' });
    mockUpsert.mockResolvedValue({
      period: '2026-05',
      status: 'PAID',
      amount: '3200.00',
      updatedAt: new Date('2026-05-07T12:00:00Z'),
      updatedBy: LANDLORD_ID,
    });

    const written = await rentalPaymentService.upsertCurrent(
      PROPERTY_ID,
      'PAID',
      LANDLORD_ID,
      new Date('2026-05-07T12:00:00Z'),
    );

    expect(written.amount).toBe(3200);

    // Confirm the write-time snapshot went into BOTH create and update payloads.
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.amount).toBe(3200);
    expect(call.update.amount).toBe(3200);

    // Confirm the ACTIVE-contract lookup is parameterized correctly.
    expect(mockContractFindFirst).toHaveBeenCalledWith({
      where: { propertyId: PROPERTY_ID, status: 'ACTIVE' },
      select: { monthlyRent: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('on upsertCurrent with no active contract, writes amount=null (null-handling path)', async () => {
    mockContractFindFirst.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({
      period: '2026-05',
      status: 'LATE',
      amount: null,
      updatedAt: new Date('2026-05-07T12:00:00Z'),
      updatedBy: LANDLORD_ID,
    });

    const written = await rentalPaymentService.upsertCurrent(
      PROPERTY_ID,
      'LATE',
      LANDLORD_ID,
      new Date('2026-05-07T12:00:00Z'),
    );

    expect(written.amount).toBeNull();

    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.amount).toBeNull();
    expect(call.update.amount).toBeNull();
  });

  it('getCurrent surfaces amount as a JSON number when the row has a value', async () => {
    mockFindUnique.mockResolvedValue({
      period: '2026-05',
      status: 'PAID',
      amount: '2799.90',
      updatedAt: new Date('2026-05-04T09:00:00Z'),
      updatedBy: LANDLORD_ID,
    });

    const view = await rentalPaymentService.getCurrent(
      PROPERTY_ID,
      new Date('2026-05-07T12:00:00Z'),
    );

    expect(view.amount).toBeCloseTo(2799.9, 2);
    expect(typeof view.amount).toBe('number');
  });

  it('getCurrent surfaces amount as null when the row is present but amount is unset (backfill gap)', async () => {
    mockFindUnique.mockResolvedValue({
      period: '2026-05',
      status: 'AWAITING',
      amount: null,
      updatedAt: new Date('2026-05-04T09:00:00Z'),
      updatedBy: null,
    });

    const view = await rentalPaymentService.getCurrent(PROPERTY_ID);
    expect(view.amount).toBeNull();
  });

  it('getCurrent default shape (no row) includes amount=null', async () => {
    mockFindUnique.mockResolvedValue(null);

    const view = await rentalPaymentService.getCurrent(
      PROPERTY_ID,
      new Date('2026-05-07T12:00:00Z'),
    );

    expect(view).toEqual({
      period: '2026-05',
      status: 'AWAITING',
      amount: null,
      updatedAt: null,
      updatedBy: null,
    });
  });
});
