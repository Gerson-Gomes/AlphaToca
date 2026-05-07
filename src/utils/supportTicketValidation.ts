import { z } from 'zod';
import { SupportTicketStatus, SupportUserRole } from '@prisma/client';

// Body de POST /api/support/tickets. Apenas `title` e `description` vêm do
// cliente — `userId`, `userName`, `userRole` e `code` são todos derivados no
// servidor (JWT + gerador). Aceitar esses campos do cliente permitiria forjar
// tickets em nome de outro usuário ou com um `code` colidindo com um já
// existente, então ficam fora do schema de entrada.
export const createSupportTicketSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(4000),
});

export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

// Query params de GET /api/admin/support/tickets. Todos opcionais — zero filtros
// retorna a lista completa ordenada por createdAt DESC.
//
// Convenções específicas:
// - `role` aceita apenas TENANT|LANDLORD (não ADMIN): a lista visa triage de
//   tickets abertos por usuários finais; admins que abrem tickets internos
//   ficam fora do filtro default. Mantido alinhado com o contrato do PRD.
// - `from`/`to` são ISO 8601 (aceita `2026-05-07`, `2026-05-07T12:00:00Z`,
//   `2026-05-07T12:00:00-03:00`, etc.) — validação via Date.parse/NaN porque
//   z.string().datetime() rejeita a forma YYYY-MM-DD sem hora, que é comum
//   em filtros de calendário do frontend.
// - `page`/`pageSize` são preprocessados de string → number via z.coerce. O
//   Express entrega `req.query` como strings ou arrays de strings; z.coerce
//   aceita string e converte. Arrays (ex.: `?page=1&page=2`) reprovam no
//   validador (z.coerce.number() não sabe lidar com array) — 400.
const isoDateLike = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Invalid ISO date' });

export const listSupportTicketsQuerySchema = z
  .object({
    status: z.nativeEnum(SupportTicketStatus).optional(),
    role: z.enum([SupportUserRole.TENANT, SupportUserRole.LANDLORD]).optional(),
    from: isoDateLike.optional(),
    to: isoDateLike.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine(
    (v) => {
      if (!v.from || !v.to) return true;
      return new Date(v.from).getTime() <= new Date(v.to).getTime();
    },
    { message: 'from must be <= to', path: ['from'] },
  );

export type ListSupportTicketsQuery = z.infer<typeof listSupportTicketsQuerySchema>;
