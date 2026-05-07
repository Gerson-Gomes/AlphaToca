import prisma from '../config/db';

// Série mensal consumida pelos charts de "Análise de Performance" do dashboard
// do landlord (LL-005). Arrays são SEMPRE paralelos a `months` — meses sem
// atividade entram como 0 (zero-fill), para o UI poder iterar por índice sem
// lookup.
export type MonthlySeries = {
  months: string[];
  rentals: number[];
  newTenants: number[];
  monthlyRevenue: number[];
};

// Enumera meses YYYY-MM (UTC) entre `from` e `to`, inclusivo em ambas as
// extremidades. Alinhado com `currentPeriod` em rentalPaymentService — todo o
// mundo no backend trata mês em UTC para evitar off-by-one no pivô do fuso.
function enumerateMonths(from: Date, to: Date): string[] {
  const fromY = from.getUTCFullYear();
  const fromM = from.getUTCMonth();
  const toY = to.getUTCFullYear();
  const toM = to.getUTCMonth();

  const months: string[] = [];
  let y = fromY;
  let m = fromM;
  while (y < toY || (y === toY && m <= toM)) {
    months.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return months;
}

export const analyticsService = {
  /**
   * Agrega contratos e pagamentos do landlord em buckets mensais entre `from`
   * e `to` (inclusivo nos dois extremos, granularidade mês UTC). Retorna três
   * séries paralelas a `months`, com zero-fill para meses vazios.
   *
   * Queries são parametrizadas via `$queryRaw` tagged-template — `landlordId`
   * NUNCA é concatenado na string, as substituições `${...}` viram placeholders
   * no prepared statement (PRD LL-004 AC).
   */
  async monthlySeries(landlordId: string, from: Date, to: Date): Promise<MonthlySeries> {
    const months = enumerateMonths(from, to);

    if (months.length === 0) {
      return { months: [], rentals: [], newTenants: [], monthlyRevenue: [] };
    }

    // Limites de data para queries por start_date: primeiro dia do `from` mês
    // e primeiro dia do mês seguinte ao `to` (exclusivo).
    const rangeStart = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const rangeEndExclusive = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 1),
    );
    const fromPeriod = months[0];
    const toPeriod = months[months.length - 1];

    const rentalsRows = await prisma.$queryRaw<{ period: string; count: bigint }[]>`
      SELECT to_char(start_date, 'YYYY-MM') AS period, COUNT(*) AS count
      FROM contracts
      WHERE landlord_id = ${landlordId}::uuid
        AND start_date >= ${rangeStart}
        AND start_date < ${rangeEndExclusive}
      GROUP BY period
    `;

    const newTenantsRows = await prisma.$queryRaw<{ period: string; count: bigint }[]>`
      SELECT to_char(first_start, 'YYYY-MM') AS period, COUNT(*) AS count
      FROM (
        SELECT tenant_id, MIN(start_date) AS first_start
        FROM contracts
        WHERE landlord_id = ${landlordId}::uuid
        GROUP BY tenant_id
      ) firsts
      WHERE first_start >= ${rangeStart}
        AND first_start < ${rangeEndExclusive}
      GROUP BY period
    `;

    const revenueRows = await prisma.$queryRaw<
      { period: string; revenue: string | number | null }[]
    >`
      SELECT rp.period AS period, COALESCE(SUM(rp.amount), 0) AS revenue
      FROM rental_payments rp
      JOIN properties p ON p.id = rp.property_id
      WHERE p.landlord_id = ${landlordId}::uuid
        AND rp.status = 'PAID'
        AND rp.period >= ${fromPeriod}
        AND rp.period <= ${toPeriod}
      GROUP BY rp.period
    `;

    const rentalsMap = new Map<string, number>(
      rentalsRows.map((r) => [r.period, Number(r.count)]),
    );
    const newTenantsMap = new Map<string, number>(
      newTenantsRows.map((r) => [r.period, Number(r.count)]),
    );
    const revenueMap = new Map<string, number>(
      revenueRows.map((r) => [r.period, Number(r.revenue ?? 0)]),
    );

    return {
      months,
      rentals: months.map((m) => rentalsMap.get(m) ?? 0),
      newTenants: months.map((m) => newTenantsMap.get(m) ?? 0),
      monthlyRevenue: months.map((m) => revenueMap.get(m) ?? 0),
    };
  },
};
