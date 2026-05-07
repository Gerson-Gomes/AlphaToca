import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    profileView: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../src/config/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import prisma from '../src/config/db';
import { profileViewService } from '../src/services/profileViewService';

const mockFindFirst = (prisma.profileView.findFirst as any) as ReturnType<typeof vi.fn>;
const mockCreate = (prisma.profileView.create as any) as ReturnType<typeof vi.fn>;

const LANDLORD_ID = '11111111-1111-1111-1111-111111111111';
const VIEWER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('profileViewService.record()', () => {
  it('inserts a row when the viewer is authenticated and no recent view exists', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'pv-1' });

    await profileViewService.record(LANDLORD_ID, VIEWER_ID);

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    const findCall = mockFindFirst.mock.calls[0][0];
    expect(findCall.where.landlordId).toBe(LANDLORD_ID);
    expect(findCall.where.viewerId).toBe(VIEWER_ID);
    expect(findCall.where.viewedAt.gte).toBeInstanceOf(Date);

    expect(mockCreate).toHaveBeenCalledWith({
      data: { landlordId: LANDLORD_ID, viewerId: VIEWER_ID },
    });
  });

  it('does NOT insert when an authenticated viewer already viewed within 24h (dedup)', async () => {
    mockFindFirst.mockResolvedValue({ id: 'pv-existing' });

    await profileViewService.record(LANDLORD_ID, VIEWER_ID);

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('always inserts for anonymous viewers (viewerId=null) — no dedup lookup', async () => {
    mockCreate.mockResolvedValue({ id: 'pv-anon' });

    await profileViewService.record(LANDLORD_ID, null);

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith({
      data: { landlordId: LANDLORD_ID, viewerId: null },
    });
  });

  it('defaults viewerId to null when omitted', async () => {
    mockCreate.mockResolvedValue({ id: 'pv-default' });

    await profileViewService.record(LANDLORD_ID);

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith({
      data: { landlordId: LANDLORD_ID, viewerId: null },
    });
  });

  it('swallows DB errors (fire-and-forget) so tracking failure never breaks the caller', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue(new Error('db down'));

    await expect(profileViewService.record(LANDLORD_ID, VIEWER_ID)).resolves.toBeUndefined();
  });

  it('uses a 24-hour lookback window for the dedup check', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'pv-1' });

    const before = Date.now();
    await profileViewService.record(LANDLORD_ID, VIEWER_ID);
    const after = Date.now();

    const findCall = mockFindFirst.mock.calls[0][0];
    const gte: Date = findCall.where.viewedAt.gte;
    const diffFromBefore = before - gte.getTime();
    const diffFromAfter = after - gte.getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    // `since = now - 24h`, so `now - since` should be ~24h (within tolerance).
    expect(diffFromBefore).toBeGreaterThanOrEqual(dayMs - 10);
    expect(diffFromAfter).toBeLessThanOrEqual(dayMs + 10);
  });
});
