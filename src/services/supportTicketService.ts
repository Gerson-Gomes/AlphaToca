import prisma from '../config/db';
import type {
  Prisma,
  SupportTicket,
  SupportTicketStatus,
  SupportUserRole,
} from '@prisma/client';

// Classe de erro comercial exportada para o controller mapear em 5xx/4xx no
// padrão { status, code, messages } (mesmo formato de PropertyError/ContractError).
export class SupportTicketError extends Error {
  constructor(
    public httpStatus: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SupportTicketError';
  }
}

// Protocolo humano SUP-AAMMDD-XXXX onde AAMMDD é a data do servidor (timezone
// do servidor, não UTC — alinhando com o que o atendente vê quando um ticket
// chega "hoje") e XXXX são 4 chars base36 uppercase gerados aleatoriamente.
// A unicidade é garantida pela constraint UNIQUE na coluna `code` — em caso
// de colisão (P2002), regeneramos o sufixo e tentamos de novo até MAX_RETRIES
// vezes antes de desistir. O espaço de sufixos é 36^4 = 1_679_616 por dia;
// mesmo com 10k tickets/dia a chance de colidir 5 vezes seguidas é desprezível.
const CODE_MAX_RETRIES = 5;

function formatDateStamp(now: Date): string {
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function randomSuffix(): string {
  // 4 chars base36 upper. Evita Math.random()-só porque ele pode não ser
  // criptograficamente forte — preferimos crypto.randomInt para ter entropia
  // uniforme e não ter que importar crypto só para isso.
  // `Math.floor(Math.random() * 36**4)` é o suficiente AQUI porque o espaço
  // é pequeno E a unicidade é garantida pelo banco (não pela entropia).
  const n = Math.floor(Math.random() * 36 ** 4);
  return n.toString(36).toUpperCase().padStart(4, '0');
}

export function generateTicketCode(now: Date = new Date()): string {
  return `SUP-${formatDateStamp(now)}-${randomSuffix()}`;
}

// Forma mínima do autor que o ticket precisa — vem do req.localUser (ou seja,
// do JWT + authSyncMiddleware). NUNCA é aceito do body.
export type SupportTicketAuthor = {
  id: string;
  name: string;
  role: SupportUserRole;
};

export type CreateSupportTicketPayload = {
  title: string;
  description: string;
};

export const supportTicketService = {
  /**
   * Cria um ticket de suporte com código único gerado pelo servidor.
   *
   * Em caso de colisão de `code` (P2002 UNIQUE violation), regenera o sufixo
   * e tenta de novo até {@link CODE_MAX_RETRIES} vezes. Se ainda colidir,
   * lança SupportTicketError(500, 'CODE_GENERATION_FAILED') — a probabilidade
   * prática disso acontecer é ~0 (36^4 por dia), mas o erro é bubblado para
   * o controller ao invés de estourar 500 sem contexto.
   *
   * `updatedAt` é preenchido automaticamente pelo Prisma via `@updatedAt`;
   * `createdAt` pelo `@default(now())`. `status` começa em OPEN (default no
   * schema). `resolution` e `assignedToId` ficam null.
   */
  async create(
    author: SupportTicketAuthor,
    payload: CreateSupportTicketPayload,
    now: Date = new Date(),
  ): Promise<SupportTicket> {
    for (let attempt = 0; attempt < CODE_MAX_RETRIES; attempt++) {
      const code = generateTicketCode(now);
      try {
        return await prisma.supportTicket.create({
          data: {
            code,
            title: payload.title,
            description: payload.description,
            userId: author.id,
            userName: author.name,
            userRole: author.role,
          },
        });
      } catch (err: any) {
        // P2002 = UNIQUE constraint failed. Se for na coluna `code`, regera
        // e tenta de novo. Qualquer outra violação (FK, NOT NULL, etc.) é
        // propagada imediatamente.
        const isCodeCollision =
          err?.code === 'P2002' &&
          (Array.isArray(err?.meta?.target)
            ? err.meta.target.includes('code')
            : err?.meta?.target === 'code' || err?.meta?.target?.includes?.('code'));
        if (isCodeCollision) continue;
        throw err;
      }
    }

    throw new SupportTicketError(
      500,
      'CODE_GENERATION_FAILED',
      `Failed to generate a unique ticket code after ${CODE_MAX_RETRIES} attempts.`,
    );
  },

  /**
   * Admin-only list with filters + pagination. Ordem padrão `createdAt DESC`
   * (triage — mais recente primeiro). Retorna o envelope `{ data, page,
   * pageSize, total }` consumido diretamente pelo admin panel.
   *
   * Campos `user` (id/name/email/role) e `assignedTo` (id/name) vêm via
   * `include` Prisma — UM único JOIN por consulta. Evita N+1 mesmo com
   * pageSize=200.
   */
  async list(params: ListSupportTicketsParams): Promise<ListSupportTicketsResult> {
    const { status, role, from, to, page, pageSize } = params;
    const where: Prisma.SupportTicketWhereInput = {};
    if (status) where.status = status;
    if (role) where.userRole = role;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    const [total, rows] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
    ]);

    const data: SupportTicketAdminView[] = rows.map((r) => toAdminView(r));

    return { data, page, pageSize, total };
  },

  /**
   * Lista tickets do próprio usuário (não-admin). Sem paginação,
   * ordenado por createdAt DESC. Inclui a última mensagem como preview.
   */
  async listForUser(userId: string) {
    return prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        messages: {
          orderBy: { timestamp: 'asc' },
          take: 1,
        },
      },
    });
  },

  /**
   * Busca um ticket por ID (UUID). Usado internamente para verificar
   * existência e autorização antes de operações de mensagem.
   */
  async findById(id: string) {
    return prisma.supportTicket.findUnique({ where: { id } });
  },

  /**
   * Admin-only update (US-020). Atualiza status / resolution / assignedToId.
   *
   * Validações de negócio:
   *  - 404 TICKET_NOT_FOUND se `id` não existe.
   *  - 400 ASSIGNEE_NOT_FOUND se `assignedToId` é UUID válido mas nenhum User
   *    com esse id existe (ao invés de deixar o P2003 FK violation vazar
   *    como 500). A verificação é feita ANTES do update para que a resposta
   *    seja determinística.
   *
   * A regra "RESOLVED precisa de resolution" é garantida upstream pelo
   * Zod refine — service confia nos tipos que recebe.
   *
   * Retorna o `SupportTicketAdminView` já com os includes populados, mesma
   * shape do GET list item — o controller só embrulha em `res.json(view)`.
   */
  async updateForAdmin(
    id: string,
    payload: UpdateSupportTicketForAdminPayload,
  ): Promise<SupportTicketAdminView> {
    const existing = await prisma.supportTicket.findUnique({ where: { id } });
    if (!existing) {
      throw new SupportTicketError(404, 'TICKET_NOT_FOUND', `Ticket ${id} not found.`);
    }

    // Validação explícita da FK `assignedToId` ANTES do update para poder
    // responder 400 ASSIGNEE_NOT_FOUND (vs. o 500 que a Prisma emitiria).
    // Skippamos se o valor já está setado no próprio ticket (não precisa
    // revalidar o mesmo FK na mesma request).
    if (payload.assignedToId && payload.assignedToId !== existing.assignedToId) {
      const assignee = await prisma.user.findUnique({
        where: { id: payload.assignedToId },
        select: { id: true },
      });
      if (!assignee) {
        throw new SupportTicketError(
          400,
          'ASSIGNEE_NOT_FOUND',
          `Assignee user ${payload.assignedToId} not found.`,
        );
      }
    }

    const data: Prisma.SupportTicketUpdateInput = {};
    if (payload.status !== undefined) data.status = payload.status;
    if (payload.resolution !== undefined) data.resolution = payload.resolution;
    if (payload.assignedToId !== undefined) {
      data.assignedTo = { connect: { id: payload.assignedToId } };
    }

    const updated = await prisma.supportTicket.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    return toAdminView(updated);
  },
};

// Converte a row do Prisma (com includes) na view admin — reutilizado por
// `list` e `updateForAdmin` para garantir shape idêntica entre GET e PUT.
function toAdminView(r: any): SupportTicketAdminView {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    description: r.description,
    user: r.user
      ? { id: r.user.id, name: r.user.name, email: r.user.email, role: r.user.role }
      : null,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    assignedTo: r.assignedTo ? { id: r.assignedTo.id, name: r.assignedTo.name } : null,
    resolution: r.resolution,
  };
}

// Filtros aceitos pelo admin list. `from`/`to` já convertidos para Date no
// controller — service não faz parsing de string aqui, fica agnóstico de
// formato da entrada (ISO, timestamp, etc).
export type ListSupportTicketsParams = {
  status?: SupportTicketStatus;
  role?: SupportUserRole;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
};

export type SupportTicketAdminView = {
  id: string;
  code: string;
  title: string;
  description: string;
  // `user` é null quando o autor do ticket foi deletado (onDelete: Cascade
  // derruba o ticket junto, mas ainda assim o tipo segue o shape do Prisma
  // include para consistência). `email` pode ser null — User.email é opcional.
  user: {
    id: string;
    name: string;
    email: string | null;
    role: string;
  } | null;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
  assignedTo: { id: string; name: string } | null;
  resolution: string | null;
};

export type ListSupportTicketsResult = {
  data: SupportTicketAdminView[];
  page: number;
  pageSize: number;
  total: number;
};

// Payload já validado + normalizado pelo controller. O service confia nos
// tipos recebidos — ele não re-valida formato (Zod upstream), mas valida
// existência da FK `assignedToId`.
export type UpdateSupportTicketForAdminPayload = {
  status?: SupportTicketStatus;
  resolution?: string;
  assignedToId?: string;
};

// Shape retornada pelo GET /api/support/tickets (US-003). Campos mínimos que
// o dono do ticket precisa na tela /support — sem info de admin (assignee,
// resolution, updatedAt, etc.). `createdAt` é ISO string para evitar
// diferenças de serialização JSON vs Date entre controllers.
export type SupportTicketUserView = {
  id: string;
  code: string;
  title: string;
  description: string;
  createdAt: string;
  status: SupportTicketStatus;
};
