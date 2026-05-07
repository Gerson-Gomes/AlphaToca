import type { PrismaClient, Visit, VisitStatus } from '@prisma/client';
import prisma from '../config/db';
import type {
  CreateVisitInput,
  UpdateVisitInput,
  ListVisitsQuery,
  AvailabilityQuery,
} from '../utils/visitValidation';
import { MAX_VISIT_DURATION_MINUTES } from '../config/visits';
import { pushNotificationService } from './pushNotificationService';
import { logger } from '../config/logger';

export type VisitErrorCode = 'PROPERTY_NOT_FOUND' | 'CONFLICT' | 'VISIT_NOT_FOUND';

export class VisitError extends Error {
  public readonly code: VisitErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: VisitErrorCode, httpStatus: number, details?: Record<string, unknown>) {
    super(code);
    this.name = 'VisitError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export type VisitPrismaClient = Pick<PrismaClient, 'visit' | 'property'>;

export interface VisitDeps {
  prisma: VisitPrismaClient;
}

const defaultDeps: VisitDeps = {
  prisma: prisma as VisitPrismaClient,
};

// Busca candidatos a conflito numa janela larga ([start - MAX, end]) e filtra
// em JS pela sobreposição real. MAX_VISIT_DURATION_MINUTES cobre o maior
// durationMinutes permitido pela validação Zod — derivar daqui garante que
// a janela SQL e o limite da API permanecem sincronizados.
const MAX_DURATION_MINUTES = MAX_VISIT_DURATION_MINUTES;

function endOf(v: { scheduledAt: Date; durationMinutes: number }): Date {
  return new Date(v.scheduledAt.getTime() + v.durationMinutes * 60_000);
}

function overlaps(
  aStart: Date,
  aDurationMin: number,
  bStart: Date,
  bDurationMin: number,
): boolean {
  const aEnd = aStart.getTime() + aDurationMin * 60_000;
  const bEnd = bStart.getTime() + bDurationMin * 60_000;
  // Back-to-back (aEnd == bStart) NÃO conta como conflito.
  return aStart.getTime() < bEnd && aEnd > bStart.getTime();
}

async function findConflicting(
  args: {
    propertyId: string;
    landlordId: string;
    scheduledAt: Date;
    durationMinutes: number;
    excludeVisitId?: string;
  },
  deps: VisitDeps,
): Promise<Visit | null> {
  const { propertyId, landlordId, scheduledAt, durationMinutes, excludeVisitId } = args;
  const windowStart = new Date(scheduledAt.getTime() - MAX_DURATION_MINUTES * 60_000);
  const windowEnd = new Date(scheduledAt.getTime() + durationMinutes * 60_000);

  const where: Parameters<VisitPrismaClient['visit']['findMany']>[0] extends infer W
    ? W
    : never = {
      status: 'SCHEDULED',
      OR: [{ propertyId }, { landlordId }],
      scheduledAt: { gte: windowStart, lte: windowEnd },
      ...(excludeVisitId ? { NOT: { id: excludeVisitId } } : {}),
    } as any;

  const candidates = (await deps.prisma.visit.findMany({
    where: where as any,
    orderBy: { scheduledAt: 'asc' },
  })) as Visit[];

  for (const c of candidates) {
    if (overlaps(scheduledAt, durationMinutes, c.scheduledAt, c.durationMinutes)) {
      return c;
    }
  }
  return null;
}

export async function createVisit(
  input: CreateVisitInput,
  deps: VisitDeps = defaultDeps,
): Promise<Visit> {
  const property = await deps.prisma.property.findUnique({
    where: { id: input.propertyId },
    select: {
      id: true,
      landlordId: true,
      title: true,
      landlord: {
        select: { fcmToken: true }
      }
    } as any,
  });
  if (!property) {
    throw new VisitError('PROPERTY_NOT_FOUND', 404, { propertyId: input.propertyId });
  }
  const landlordId = (property as unknown as { landlordId: string }).landlordId;

  const conflict = await findConflicting(
    {
      propertyId: input.propertyId,
      landlordId,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
    },
    deps,
  );
  if (conflict) {
    throw new VisitError('CONFLICT', 409, { conflictWith: conflict.id });
  }

  const visit = await deps.prisma.visit.create({
    data: {
      propertyId: input.propertyId,
      tenantId: input.tenantId,
      landlordId,
      rentalProcessId: input.rentalProcessId ?? null,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      source: input.source,
      notes: input.notes ?? null,
    },
  });

  // Gatilho Isolado: Dispara notificação push + persiste no histórico para o locador
  const landlordFcmToken = (property as any).landlord?.fcmToken;
  const landlordId2 = (property as unknown as { landlordId: string }).landlordId;
  const propertyTitle = (property as any).title;

  pushNotificationService.notify({
    userId: landlordId2,
    fcmToken: landlordFcmToken,
    type: 'VISIT_SCHEDULED',
    title: 'Nova Visita Agendada!',
    body: `Uma visita foi agendada para o seu imóvel: ${propertyTitle}`,
    data: {
      visitId: visit.id,
      propertyId: input.propertyId,
      type: 'VISIT_SCHEDULED'
    }
  }).catch(err => {
    logger.error({ err, visitId: visit.id }, '[visitService] Falha ao disparar notificação de nova visita');
  });

  return visit;
}

export async function getVisitById(
  id: string,
  deps: VisitDeps = defaultDeps,
): Promise<Visit | null> {
  return deps.prisma.visit.findUnique({ where: { id } });
}

export async function listVisits(
  query: Partial<ListVisitsQuery>,
  deps: VisitDeps = defaultDeps,
): Promise<Visit[]> {
  const where: Record<string, unknown> = {};
  if (query.propertyId) where.propertyId = query.propertyId;
  if (query.tenantId) where.tenantId = query.tenantId;
  if (query.landlordId) where.landlordId = query.landlordId;
  if (query.status) where.status = query.status;
  if (query.from || query.to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (query.from) range.gte = query.from;
    if (query.to) range.lte = query.to;
    where.scheduledAt = range;
  }
  return deps.prisma.visit.findMany({
    where: where as any,
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function updateVisit(
  id: string,
  input: UpdateVisitInput,
  deps: VisitDeps = defaultDeps,
): Promise<Visit | null> {
  const existing = await deps.prisma.visit.findUnique({ where: { id } });
  if (!existing) return null;

  const scheduledAt = input.scheduledAt ?? existing.scheduledAt;
  const durationMinutes = input.durationMinutes ?? existing.durationMinutes;
  const nextStatus: VisitStatus = (input.status ?? existing.status) as VisitStatus;

  const scheduleChanged =
    input.scheduledAt !== undefined || input.durationMinutes !== undefined;
  const reactivating =
    input.status !== undefined && input.status === 'SCHEDULED' && existing.status !== 'SCHEDULED';

  if (nextStatus === 'SCHEDULED' && (scheduleChanged || reactivating)) {
    const conflict = await findConflicting(
      {
        propertyId: existing.propertyId,
        landlordId: existing.landlordId,
        scheduledAt,
        durationMinutes,
        excludeVisitId: id,
      },
      deps,
    );
    if (conflict) {
      throw new VisitError('CONFLICT', 409, { conflictWith: conflict.id });
    }
  }

  const updated = await deps.prisma.visit.update({
    where: { id },
    data: {
      ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}),
      ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });

  // Gatilho: notifica o inquilino quando a visita é concluída
  if (input.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
    const tenant = await prisma.user.findUnique({
      where: { id: existing.tenantId },
      select: { fcmToken: true },
    });
    const property = await prisma.property.findUnique({
      where: { id: existing.propertyId },
      select: { title: true },
    });

    pushNotificationService.notify({
      userId: existing.tenantId,
      fcmToken: tenant?.fcmToken,
      type: 'VISIT_COMPLETED',
      title: 'Como foi a visita?',
      body: `Você visitou o imóvel "${property?.title}". Continue o processo de locação pelo app!`,
      data: { visitId: id, propertyId: existing.propertyId, type: 'VISIT_COMPLETED' },
    }).catch(err => logger.error({ err, visitId: id }, '[visitService] Falha ao disparar notificação VISIT_COMPLETED'));
  }

  return updated;
}

export async function cancelVisit(
  id: string,
  deps: VisitDeps = defaultDeps,
): Promise<boolean> {
  const existing = await deps.prisma.visit.findUnique({ where: { id } });
  if (!existing) return false;

  await deps.prisma.visit.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });

  // Busca dados de locador, inquilino e imóvel para as notificações
  const [landlord, tenant, property] = await Promise.all([
    prisma.user.findUnique({ where: { id: existing.landlordId }, select: { fcmToken: true } }),
    prisma.user.findUnique({ where: { id: existing.tenantId }, select: { fcmToken: true } }),
    prisma.property.findUnique({ where: { id: existing.propertyId }, select: { title: true } }),
  ]);

  const propertyTitle = property?.title ?? 'imóvel';

  // Notifica o locador (confirmação de cancelamento)
  pushNotificationService.notify({
    userId: existing.landlordId,
    fcmToken: landlord?.fcmToken,
    type: 'VISIT_CANCELLED',
    title: 'Visita Cancelada',
    body: `A visita ao imóvel "${propertyTitle}" foi cancelada com sucesso.`,
    data: { visitId: id, propertyId: existing.propertyId, type: 'VISIT_CANCELLED' },
  }).catch(err => logger.error({ err, visitId: id }, '[visitService] Falha ao notificar locador sobre VISIT_CANCELLED'));

  // Notifica o inquilino (aviso de cancelamento)
  pushNotificationService.notify({
    userId: existing.tenantId,
    fcmToken: tenant?.fcmToken,
    type: 'VISIT_CANCELLED',
    title: 'Visita Cancelada',
    body: `Sua visita ao imóvel "${propertyTitle}" foi cancelada.`,
    data: { visitId: id, propertyId: existing.propertyId, type: 'VISIT_CANCELLED' },
  }).catch(err => logger.error({ err, visitId: id }, '[visitService] Falha ao notificar inquílino sobre VISIT_CANCELLED'));

  return true;
}

export interface AvailableSlot {
  startsAt: Date;
  endsAt: Date;
}

export async function listAvailableSlots(
  query: AvailabilityQuery,
  deps: VisitDeps = defaultDeps,
): Promise<AvailableSlot[]> {
  const property = await deps.prisma.property.findUnique({
    where: { id: query.propertyId },
    select: { id: true, landlordId: true } as any,
  });
  if (!property) {
    throw new VisitError('PROPERTY_NOT_FOUND', 404, { propertyId: query.propertyId });
  }
  // const landlordId = (property as { landlordId: string }).landlordId;
  const landlordId = (property as unknown as { landlordId: string }).landlordId;

  // Busca tudo que possa colidir no intervalo — property OU landlord ocupados
  const busy = (await deps.prisma.visit.findMany({
    where: {
      status: 'SCHEDULED',
      OR: [{ propertyId: query.propertyId }, { landlordId }],
      scheduledAt: {
        gte: new Date(query.from.getTime() - MAX_DURATION_MINUTES * 60_000),
        lte: query.to,
      },
    } as any,
    orderBy: { scheduledAt: 'asc' },
  })) as Visit[];

  const slotMs = query.slotMinutes * 60_000;
  const slots: AvailableSlot[] = [];
  let cursor = query.from.getTime();
  const windowEnd = query.to.getTime();

  while (cursor + slotMs <= windowEnd) {
    const start = new Date(cursor);
    const end = new Date(cursor + slotMs);
    const collides = busy.some((b) =>
      overlaps(start, query.slotMinutes, b.scheduledAt, b.durationMinutes),
    );
    if (!collides) {
      slots.push({ startsAt: start, endsAt: end });
    }
    cursor += slotMs;
  }

  return slots;
}
