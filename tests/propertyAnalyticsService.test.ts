import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/db', () => ({
  default: {
    propertyViewEvent: { count: vi.fn() },
    favorite: { count: vi.fn() },
    proposal: { count: vi.fn() },
    visit: { count: vi.fn() },
    contactClickEvent: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import prisma from '../src/config/db';
import { propertyAnalyticsService } from '../src/services/propertyAnalyticsService';

const mockViewCount = (prisma.propertyViewEvent.count as unknown) as ReturnType<typeof vi.fn>;
const mockFavoriteCount = (prisma.favorite.count as unknown) as ReturnType<typeof vi.fn>;
const mockProposalCount = (prisma.proposal.count as unknown) as ReturnType<typeof vi.fn>;
const mockVisitCount = (prisma.visit.count as unknown) as ReturnType<typeof vi.fn>;
const mockContactClickCount = (prisma.contactClickEvent.count as unknown) as ReturnType<typeof vi.fn>;
const mockQueryRaw = (prisma.$queryRaw as unknown) as ReturnType<typeof vi.fn>;

const PROPERTY_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Freeze clock so windowStart/windowEnd math is deterministic across runs.
const FIXED_NOW = new Date('2026-05-07T15:30:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('propertyAnalyticsService.getAnalytics() — LL-008', () => {
  it('returns the shape { views, favorites, proposalsTotal, proposalsOpen, visitsScheduled, contactClicks, dailyViews } for window=30d', async () => {
    mockViewCount.mockResolvedValue(142);
    mockFavoriteCount.mockResolvedValue(23);
    // proposalsTotal is the first proposal.count call; proposalsOpen the second.
    mockProposalCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    mockVisitCount.mockResolvedValue(3);
    mockContactClickCount.mockResolvedValue(18);
    mockQueryRaw.mockResolvedValue([
      { bucket: '2026-05-06', count: 7n },
      { bucket: '2026-05-07', count: 3n },
    ]);

    const result = await propertyAnalyticsService.getAnalytics(PROPERTY_ID, '30d');

    expect(result.views).toBe(142);
    expect(result.favorites).toBe(23);
    expect(result.proposalsTotal).toBe(5);
    expect(result.proposalsOpen).toBe(2);
    expect(result.visitsScheduled).toBe(3);
    expect(result.contactClicks).toBe(18);

    // 30 daily buckets (inclusive of today UTC). The two non-zero buckets land
    // at known dates; the rest are zero-filled.
    expect(result.dailyViews).toHaveLength(30);
    const lookup = new Map(result.dailyViews.map((d) => [d.date, d.count]));
    expect(lookup.get('2026-05-06')).toBe(7);
    expect(lookup.get('2026-05-07')).toBe(3);
    // Every entry should be a number (no NaN / null leakage from the bigint coercion).
    for (const entry of result.dailyViews) {
      expect(typeof entry.count).toBe('number');
    }
  });

  it('zero-fills dailyViews across the whole window when no events exist', async () => {
    mockViewCount.mockResolvedValue(0);
    mockFavoriteCount.mockResolvedValue(0);
    mockProposalCount.mockResolvedValue(0);
    mockVisitCount.mockResolvedValue(0);
    mockContactClickCount.mockResolvedValue(0);
    mockQueryRaw.mockResolvedValue([]);

    const result = await propertyAnalyticsService.getAnalytics(PROPERTY_ID, '30d');

    expect(result.dailyViews).toHaveLength(30);
    for (const entry of result.dailyViews) {
      expect(entry.count).toBe(0);
    }
    // Last bucket should be today (UTC, matching the frozen clock).
    expect(result.dailyViews[result.dailyViews.length - 1].date).toBe('2026-05-07');
    // First bucket is 29 days before today.
    expect(result.dailyViews[0].date).toBe('2026-04-08');
  });

  it('window=90d produces a 90-day daily series', async () => {
    mockViewCount.mockResolvedValue(0);
    mockFavoriteCount.mockResolvedValue(0);
    mockProposalCount.mockResolvedValue(0);
    mockVisitCount.mockResolvedValue(0);
    mockContactClickCount.mockResolvedValue(0);
    mockQueryRaw.mockResolvedValue([]);

    const result = await propertyAnalyticsService.getAnalytics(PROPERTY_ID, '90d');

    expect(result.dailyViews).toHaveLength(90);
    expect(result.dailyViews[result.dailyViews.length - 1].date).toBe('2026-05-07');
  });

  it('window=1y produces a 365-day daily series', async () => {
    mockViewCount.mockResolvedValue(0);
    mockFavoriteCount.mockResolvedValue(0);
    mockProposalCount.mockResolvedValue(0);
    mockVisitCount.mockResolvedValue(0);
    mockContactClickCount.mockResolvedValue(0);
    mockQueryRaw.mockResolvedValue([]);

    const result = await propertyAnalyticsService.getAnalytics(PROPERTY_ID, '1y');

    expect(result.dailyViews).toHaveLength(365);
    expect(result.dailyViews[result.dailyViews.length - 1].date).toBe('2026-05-07');
  });

  it('passes filters that scope each count to the right window/status/relation', async () => {
    mockViewCount.mockResolvedValue(0);
    mockFavoriteCount.mockResolvedValue(0);
    mockProposalCount.mockResolvedValue(0);
    mockVisitCount.mockResolvedValue(0);
    mockContactClickCount.mockResolvedValue(0);
    mockQueryRaw.mockResolvedValue([]);

    await propertyAnalyticsService.getAnalytics(PROPERTY_ID, '30d');

    // views: window-bounded
    const viewArgs = mockViewCount.mock.calls[0][0];
    expect(viewArgs.where.propertyId).toBe(PROPERTY_ID);
    expect(viewArgs.where.viewedAt.gte).toBeInstanceOf(Date);
    expect(viewArgs.where.viewedAt.lt).toBeInstanceOf(Date);

    // favorites: all-time, no date filter
    const favArgs = mockFavoriteCount.mock.calls[0][0];
    expect(favArgs.where).toEqual({ propertyId: PROPERTY_ID });

    // proposalsTotal (first call): window-bounded by createdAt
    const propTotalArgs = mockProposalCount.mock.calls[0][0];
    expect(propTotalArgs.where.propertyId).toBe(PROPERTY_ID);
    expect(propTotalArgs.where.createdAt).toBeDefined();

    // proposalsOpen (second call): all-time, status=PENDING
    const propOpenArgs = mockProposalCount.mock.calls[1][0];
    expect(propOpenArgs.where).toEqual({ propertyId: PROPERTY_ID, status: 'PENDING' });

    // visitsScheduled: all-time, status=SCHEDULED
    const visitArgs = mockVisitCount.mock.calls[0][0];
    expect(visitArgs.where).toEqual({ propertyId: PROPERTY_ID, status: 'SCHEDULED' });

    // contactClicks: window-bounded by clickedAt
    const ccArgs = mockContactClickCount.mock.calls[0][0];
    expect(ccArgs.where.propertyId).toBe(PROPERTY_ID);
    expect(ccArgs.where.clickedAt).toBeDefined();
  });

  it('coerces bigint counts from the dailyViews raw query to number', async () => {
    mockViewCount.mockResolvedValue(0);
    mockFavoriteCount.mockResolvedValue(0);
    mockProposalCount.mockResolvedValue(0);
    mockVisitCount.mockResolvedValue(0);
    mockContactClickCount.mockResolvedValue(0);
    mockQueryRaw.mockResolvedValue([
      { bucket: '2026-05-07', count: 12n }, // bigint — must become plain number
    ]);

    const result = await propertyAnalyticsService.getAnalytics(PROPERTY_ID, '30d');
    const today = result.dailyViews.find((d) => d.date === '2026-05-07');
    expect(today?.count).toBe(12);
    expect(typeof today?.count).toBe('number');
  });
});
