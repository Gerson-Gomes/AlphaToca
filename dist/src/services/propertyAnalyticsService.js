"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.propertyAnalyticsService = void 0;
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
// Número de dias contados (inclusive o dia atual) para cada valor de `window`.
// A janela sempre termina no instante da chamada e começa `days-1` dias antes
// às 00:00 UTC — os buckets diários então cobrem exatamente `days` dias
// consecutivos (dia atual inclusive).
const WINDOW_DAYS = {
    '30d': 30,
    '90d': 90,
    '1y': 365,
};
function startOfUtcDay(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDaysUtc(d, days) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}
function formatYyyyMmDd(d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
// Enumera YYYY-MM-DD (UTC) entre `from` (inclusive) e `to` (exclusive) — mesma
// semântica que o range exclusivo usado na query de $queryRaw. Todo o backend
// trata datas em UTC, então o dia do bucket corresponde ao dia UTC do evento.
function enumerateDays(fromInclusive, toExclusive) {
    const days = [];
    let cursor = startOfUtcDay(fromInclusive);
    const end = startOfUtcDay(toExclusive);
    while (cursor.getTime() < end.getTime()) {
        days.push(formatYyyyMmDd(cursor));
        cursor = addDaysUtc(cursor, 1);
    }
    return days;
}
exports.propertyAnalyticsService = {
    /**
     * Agrega métricas por-imóvel para o endpoint LL-008 GET
     * /api/properties/:id/analytics. Contadores within-window usam
     * `windowStart ≤ ts < nowUtc(endOfDay)`; contadores all-time ignoram janela.
     *
     * O caller (controller) deve garantir que o `propertyId` existe e pertence ao
     * locador — este service confia no guard.
     */
    async getAnalytics(propertyId, window) {
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
        const [views, favorites, proposalsTotal, proposalsOpen, visitsScheduled, contactClicks, dailyViewsRows,] = await Promise.all([
            db_1.default.propertyViewEvent.count({
                where: {
                    propertyId,
                    viewedAt: { gte: fromInclusive, lt: toExclusive },
                },
            }),
            db_1.default.favorite.count({
                where: { propertyId },
            }),
            db_1.default.proposal.count({
                where: {
                    propertyId,
                    createdAt: { gte: fromInclusive, lt: toExclusive },
                },
            }),
            db_1.default.proposal.count({
                where: { propertyId, status: client_1.ProposalStatus.PENDING },
            }),
            db_1.default.visit.count({
                where: { propertyId, status: client_1.VisitStatus.SCHEDULED },
            }),
            db_1.default.contactClickEvent.count({
                where: {
                    propertyId,
                    clickedAt: { gte: fromInclusive, lt: toExclusive },
                },
            }),
            db_1.default.$queryRaw `
        SELECT to_char(viewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket,
               COUNT(*) AS count
        FROM property_view_events
        WHERE property_id = ${propertyId}::uuid
          AND viewed_at >= ${fromInclusive}
          AND viewed_at < ${toExclusive}
        GROUP BY bucket
      `,
        ]);
        const dailyMap = new Map(dailyViewsRows.map((row) => [row.bucket, Number(row.count)]));
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
