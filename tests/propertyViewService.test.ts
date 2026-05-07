import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    propertyViewEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    property: {
      update: vi.fn(),
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
import { propertyViewService } from '../src/services/propertyViewService';

const mockFindFirst = (prisma.propertyViewEvent.findFirst as any) as ReturnType<typeof vi.fn>;
const mockCreate = (prisma.propertyViewEvent.create as any) as ReturnType<typeof vi.fn>;
const mockPropertyUpdate = (prisma.property.update as any) as ReturnType<typeof vi.fn>;

const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const VIEWER_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('propertyViewService.record()', () => {
  it('inserts an event and increments Property.views when the viewer is authenticated and no recent view exists', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'pve-1' });
    mockPropertyUpdate.mockResolvedValue({ id: PROPERTY_ID, views: 1 });

    await propertyViewService.record(PROPERTY_ID, VIEWER_ID);

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    const findCall = mockFindFirst.mock.calls[0][0];
    expect(findCall.where.propertyId).toBe(PROPERTY_ID);
    expect(findCall.where.viewerId).toBe(VIEWER_ID);
    expect(findCall.where.viewedAt.gte).toBeInstanceOf(Date);

    expect(mockCreate).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, viewerId: VIEWER_ID },
    });

    // Property.views counter is preserved and still incremented (FR-12).
    expect(mockPropertyUpdate).toHaveBeenCalledWith({
      where: { id: PROPERTY_ID },
      data: { views: { increment: 1 } },
    });
  });

  it('does NOT insert and does NOT increment views when an authenticated viewer already viewed within 1h (dedup)', async () => {
    mockFindFirst.mockResolvedValue({ id: 'pve-existing' });

    await propertyViewService.record(PROPERTY_ID, VIEWER_ID);

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPropertyUpdate).not.toHaveBeenCalled();
  });

  it('always inserts and increments views for anonymous viewers (viewerId=null) — no dedup lookup', async () => {
    mockCreate.mockResolvedValue({ id: 'pve-anon' });
    mockPropertyUpdate.mockResolvedValue({ id: PROPERTY_ID, views: 1 });

    await propertyViewService.record(PROPERTY_ID, null);

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, viewerId: null },
    });
    expect(mockPropertyUpdate).toHaveBeenCalledWith({
      where: { id: PROPERTY_ID },
      data: { views: { increment: 1 } },
    });
  });

  it('defaults viewerId to null when omitted', async () => {
    mockCreate.mockResolvedValue({ id: 'pve-default' });
    mockPropertyUpdate.mockResolvedValue({ id: PROPERTY_ID, views: 1 });

    await propertyViewService.record(PROPERTY_ID);

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, viewerId: null },
    });
    expect(mockPropertyUpdate).toHaveBeenCalledTimes(1);
  });

  it('swallows DB errors (fire-and-forget) so tracking failure never breaks the caller', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue(new Error('db down'));

    await expect(propertyViewService.record(PROPERTY_ID, VIEWER_ID)).resolves.toBeUndefined();
  });

  it('swallows errors from the views-counter update too', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'pve-1' });
    mockPropertyUpdate.mockRejectedValue(new Error('update failed'));

    await expect(propertyViewService.record(PROPERTY_ID, VIEWER_ID)).resolves.toBeUndefined();
  });

  it('uses a 1-hour lookback window for the dedup check', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'pve-1' });
    mockPropertyUpdate.mockResolvedValue({ id: PROPERTY_ID, views: 1 });

    const before = Date.now();
    await propertyViewService.record(PROPERTY_ID, VIEWER_ID);
    const after = Date.now();

    const findCall = mockFindFirst.mock.calls[0][0];
    const gte: Date = findCall.where.viewedAt.gte;
    const diffFromBefore = before - gte.getTime();
    const diffFromAfter = after - gte.getTime();
    const hourMs = 60 * 60 * 1000;

    // `since = now - 1h`, so `now - since` should be ~1h (within tolerance).
    expect(diffFromBefore).toBeGreaterThanOrEqual(hourMs - 10);
    expect(diffFromAfter).toBeLessThanOrEqual(hourMs + 10);
  });
});
