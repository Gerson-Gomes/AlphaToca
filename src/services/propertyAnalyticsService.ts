import { ProposalStatus, VisitStatus } from '@prisma/client';
import prisma from '../config/db';

export type AnalyticsWindow = '30d' | '90d' | '1y';

export type PropertyAnalyticsResult = {
  views: number;
  favorites: number;
  proposalsTotal: number;
  proposalsOpen: number;
  visitsScheduled: number;
  contactClicks: number;
  dailyViews: Array<{ date: string; count: number }>;
};

// Número de dias contados (inclusive o dia atual) para cada valor de `window`.
// A janela sempre termina no instante da chamada e começa `days-1` dias antes
// às 00:00 UTC — os buckets diários então cobrem exatamente `days` dias
// consecutivos (dia atual inclusive).
const WINDOW_DAYS: Record<AnalyticsWindow, number> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function formatYyyyMmDd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Enumera YYYY-MM-DD (UTC) entre `from` (inclusive) e `to` (exclusive) — mesma
// semântica que o range exclusivo usado na query de $queryRaw. Todo o backend
// trata datas em UTC, então o dia do bucket corresponde ao dia UTC do evento.
function enumerateDays(fromInclusive: Date, toExclusive: Date): string[] {
  const days: string[] = [];
  let cursor = startOfUtcDay(fromInclusive);
  const end = startOfUtcDay(toExclusive);
  while (cursor.getTime() < end.getTime()) {
    days.push(formatYyyyMmDd(cursor));
    cursor = addDaysUtc(cursor, 1);
  }
  return days;
}

export const propertyAnalyticsService = {
  /**
   * Agrega métricas por-imóvel para o endpoint LL-008 GET
   * /api/properties/:id/analytics. Contadores within-window usam
   * `windowStart ≤ ts < nowUtc(endOfDay)`; contadores all-time ignoram janela.
   *
   * O caller (controller) deve garantir que o `propertyId` existe e pertence ao
   * locador — este service confia no guard.
   */
  async getAnalytics(
    propertyId: string,
    window: AnalyticsWindow,
  ): Promise<PropertyAnalyticsResult> {
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    // `toExclusive` é o início do dia seguinte — garante que eventos registrados
    // durante o dia corrente entrem no bucket de hoje (em vez de serem cortados
    // no start-of-day do "agora").
    const toExclusive = addDaysUtc(todayStart, 1);
    const fromInclusive = addDaysUtc(toExclusive, -WINDOW_DAYS[window]);

    // Seis contagens + um raw group-by, todas independentes — disparadas em
    // paralelo (`Promise.all`) já que o Prisma driver suporta concorrência de
    // statements no mesmo pool (não há transação envolvendo todas).
    const [
      views,
      favorites,
      proposalsTotal,
      proposalsOpen,
      visitsScheduled,
      contactClicks,
      dailyViewsRows,
    ] = await Promise.all([
      prisma.propertyViewEvent.count({
        where: {
          propertyId,
          viewedAt: { gte: fromInclusive, lt: toExclusive },
        },
      }),
      prisma.favorite.count({
        where: { propertyId },
      }),
      prisma.proposal.count({
        where: {
          propertyId,
          createdAt: { gte: fromInclusive, lt: toExclusive },
        },
      }),
      prisma.proposal.count({
        where: { propertyId, status: ProposalStatus.PENDING },
      }),
      prisma.visit.count({
        where: { propertyId, status: VisitStatus.SCHEDULED },
      }),
      prisma.contactClickEvent.count({
        where: {
          propertyId,
          clickedAt: { gte: fromInclusive, lt: toExclusive },
        },
      }),
      prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
        SELECT to_char(viewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket,
               COUNT(*) AS count
        FROM property_view_events
        WHERE property_id = ${propertyId}::uuid
          AND viewed_at >= ${fromInclusive}
          AND viewed_at < ${toExclusive}
        GROUP BY bucket
      `,
    ]);

    const dailyMap = new Map<string, number>(
      dailyViewsRows.map((row) => [row.bucket, Number(row.count)]),
    );
    const dailyViews = enumerateDays(fromInclusive, toExclusive).map((date) => ({
      date,
      count: dailyMap.get(date) ?? 0,
    }));

    return {
      views,
      favorites,
      proposalsTotal,
      proposalsOpen,
      visitsScheduled,
      contactClicks,
      dailyViews,
    };
  },
};
