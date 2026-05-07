import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    contactClickEvent: {
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
import { contactClickEventService } from '../src/services/contactClickEventService';

const mockCreate = (prisma.contactClickEvent.create as any) as ReturnType<typeof vi.fn>;

const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const VIEWER_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('contactClickEventService.record()', () => {
  it('inserts a row with viewerId and propertyId when the viewer is authenticated', async () => {
    mockCreate.mockResolvedValue({ id: 'cce-1' });

    await contactClickEventService.record(PROPERTY_ID, VIEWER_ID);

    expect(mockCreate).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, viewerId: VIEWER_ID },
    });
  });

  it('inserts a row with viewerId=null for anonymous callers', async () => {
    mockCreate.mockResolvedValue({ id: 'cce-anon' });

    await contactClickEventService.record(PROPERTY_ID, null);

    expect(mockCreate).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, viewerId: null },
    });
  });

  it('defaults viewerId to null when omitted', async () => {
    mockCreate.mockResolvedValue({ id: 'cce-default' });

    await contactClickEventService.record(PROPERTY_ID);

    expect(mockCreate).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, viewerId: null },
    });
  });

  it('does NOT dedup — a second call within ms issues a second insert (every click counts)', async () => {
    mockCreate.mockResolvedValue({ id: 'cce-dup' });

    await contactClickEventService.record(PROPERTY_ID, VIEWER_ID);
    await contactClickEventService.record(PROPERTY_ID, VIEWER_ID);

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('propagates DB errors — unlike view tracking, controller needs to map failure to HTTP 500', async () => {
    mockCreate.mockRejectedValue(new Error('db down'));

    await expect(
      contactClickEventService.record(PROPERTY_ID, VIEWER_ID),
    ).rejects.toThrow('db down');
  });
});
