import prisma from '../config/db';
import { Prisma, ReportStatus } from '@prisma/client';

export type CreateReportPayload = {
  reporterId: string;
  targetType: 'USER' | 'PROPERTY';
  targetId: string;
  reason: string;
  description: string;
};

export type AdminReportView = {
  id: string;
  reporterId: string;
  reporterName: string;
  targetType: string;
  targetId: string;
  reason: string;
  description: string;
  status: string;
  resolution: string | null;
  createdAt: string;
};

export type AdminReportListView = {
  data: AdminReportView[];
  page: number;
  pageSize: number;
  total: number;
};

export type ListReportsParams = {
  status?: ReportStatus;
  targetType?: string;
  page: number;
  pageSize: number;
};

export type UpdateReportPayload = {
  status: ReportStatus;
  resolution?: string;
};

export async function createReport(payload: CreateReportPayload) {
  return prisma.report.create({
    data: {
      reporterId: payload.reporterId,
      targetType: payload.targetType,
      targetId: payload.targetId,
      reason: payload.reason,
      description: payload.description,
    },
    include: {
      reporter: { select: { id: true, name: true } },
    },
  });
}

function toAdminView(r: any): AdminReportView {
  return {
    id: r.id,
    reporterId: r.reporterId,
    reporterName: r.reporter?.name ?? 'Usuário excluído',
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    description: r.description,
    status: r.status,
    resolution: r.resolution,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  };
}

export async function listReports(params: ListReportsParams): Promise<AdminReportListView> {
  const { status, targetType, page, pageSize } = params;
  const where: Prisma.ReportWhereInput = {};
  if (status) where.status = status;
  if (targetType) where.targetType = targetType;

  const [total, rows] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        reporter: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    data: rows.map(toAdminView),
    page,
    pageSize,
    total,
  };
}

export async function updateReport(
  id: string,
  payload: UpdateReportPayload,
  adminId: string,
) {
  const existing = await prisma.report.findUnique({ where: { id } });
  if (!existing) return null;

  const data: Prisma.ReportUpdateInput = { status: payload.status };
  if (payload.resolution !== undefined) data.resolution = payload.resolution;
  if (payload.status === 'RESOLVED' || payload.status === 'DISMISSED') {
    data.resolvedBy = adminId;
    data.resolvedAt = new Date();
  }

  const updated = await prisma.report.update({
    where: { id },
    data,
    include: {
      reporter: { select: { id: true, name: true } },
    },
  });

  return toAdminView(updated);
}
