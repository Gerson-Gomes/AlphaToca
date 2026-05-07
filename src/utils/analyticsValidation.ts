import { z } from 'zod';

// Aceita apenas o primeiro dia do mês em UTC, formato YYYY-MM-01. Alinha com
// `currentPeriod` do rentalPaymentService — todo o backend trata mês em UTC,
// então o cliente NUNCA informa day/hour/tz.
const monthIsoRegex = /^\d{4}-(0[1-9]|1[0-2])-01$/;

export const monthlyAnalyticsQuerySchema = z
  .object({
    from: z
      .string()
      .regex(monthIsoRegex, 'from must match YYYY-MM-01 (first day of month, UTC)')
      .optional(),
    to: z
      .string()
      .regex(monthIsoRegex, 'to must match YYYY-MM-01 (first day of month, UTC)')
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Regras de span só se aplicam quando ambos estão presentes. Quando um ou
    // ambos são omitidos, o controller aplica o default "últimos 6 meses".
    if (!data.from || !data.to) return;

    const from = new Date(`${data.from}T00:00:00.000Z`);
    const to = new Date(`${data.to}T00:00:00.000Z`);

    if (from.getTime() > to.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from must be less than or equal to to',
        path: ['from'],
      });
      return;
    }

    const monthSpan =
      (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
      (to.getUTCMonth() - from.getUTCMonth()) +
      1;

    if (monthSpan > 24) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date range cannot exceed 24 months',
        path: ['to'],
      });
    }
  });

export type MonthlyAnalyticsQueryInput = z.infer<typeof monthlyAnalyticsQuerySchema>;

// Janelas aceitas pelo endpoint LL-008 GET /api/properties/:id/analytics.
// Valores espelham as abas "30 dias", "90 dias", "1 ano" na UI do landlord.
// Default ('30d') aplicado no controller quando a query é omitida.
export const propertyAnalyticsQuerySchema = z.object({
  window: z.enum(['30d', '90d', '1y']).optional(),
});

export type PropertyAnalyticsQueryInput = z.infer<typeof propertyAnalyticsQuerySchema>;

export const propertyAnalyticsParamsSchema = z.object({
  id: z.string().uuid(),
});
