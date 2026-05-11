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

// Body de PUT /api/admin/support/tickets/:id (US-020).
// Todos os campos opcionais individualmente — mas pelo menos UM é obrigatório
// (validado via refine). `status` só aceita OPEN|RESOLVED — reabrir um ticket
// é permitido (RESOLVED → OPEN) para cobrir casos onde a resolução inicial
// não resolveu. `resolution` é TEXT até 4000 chars. `assignedToId` é um UUID
// do User responsável — a existência desse User é validada no serviço
// (resulta em 400 ASSIGNEE_NOT_FOUND no controller, não um 500 por FK).
//
// Regra cruzada: se `status` está explicitamente setado para RESOLVED, então
// `resolution` tem que estar presente NA MESMA request — o controller-level
// 400 VALIDATION_ERROR aqui garante que a coluna resolution não fica nula no
// fechamento do ticket.
export const updateSupportTicketSchema = z
  .object({
    status: z.nativeEnum(SupportTicketStatus).optional(),
    resolution: z.string().min(1).max(4000).optional(),
    assignedToId: z.string().uuid().optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.resolution !== undefined || v.assignedToId !== undefined,
    { message: 'At least one of status, resolution, or assignedToId must be provided.' },
  )
  .refine(
    (v) => {
      if (v.status === SupportTicketStatus.RESOLVED) {
        return typeof v.resolution === 'string' && v.resolution.length > 0;
      }
      return true;
    },
    {
      message: 'resolution is required when status transitions to RESOLVED.',
      path: ['resolution'],
    },
  );

export type UpdateSupportTicketInput = z.infer<typeof updateSupportTicketSchema>;

// Body de POST /api/support/tickets/:id/messages
// `clientMessageId` é um UUID gerado pelo cliente para idempotência —
// se o backend já tiver uma mensagem com esse ID, retorna a existente
// em vez de criar duplicata.
export const sendTicketMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required').max(4000),
  clientMessageId: z.string().uuid().optional(),
});

export type SendTicketMessageInput = z.infer<typeof sendTicketMessageSchema>;

// Query params de GET /api/support/tickets/:id/messages
// `since` é um timestamp ISO 8601 — o backend só retorna mensagens
// com timestamp > since, fechando o gap entre REST e WebSocket.
export const getTicketMessagesQuerySchema = z.object({
  since: isoDateLike.optional(),
});
