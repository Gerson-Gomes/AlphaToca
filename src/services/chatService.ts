import prisma from '../config/db';
import { SenderType, ChatStatus } from '@prisma/client';

export async function getOrCreateSession(tenantId: string) {
  // Try to find an active session (not resolved and not expired)
  let session = await prisma.chatSession.findFirst({
    where: {
      tenantId,
      status: { not: 'RESOLVED' },
      expiresAt: { gt: new Date() }
    },
    include: {
      messages: {
        orderBy: { timestamp: 'desc' },
        take: 50
      }
    }
  });

  if (!session) {
    session = await prisma.chatSession.create({
      data: {
        tenantId,
        status: 'ACTIVE_BOT'
      },
      include: {
        messages: true
      }
    });
  }

  return session;
}

export async function listSessions(filters: { tenantId?: string; status?: ChatStatus }) {
  const where: any = {};
  if (filters.tenantId) where.tenantId = filters.tenantId;
  if (filters.status) where.status = filters.status;
  return prisma.chatSession.findMany({
    where,
    include: {
      tenant: { select: { id: true, name: true, phoneNumber: true } },
      _count: { select: { messages: true } },
      messages: {
        orderBy: { timestamp: 'desc' },
        take: 1,
        select: { content: true, timestamp: true, senderType: true },
      },
    },
    orderBy: { startedAt: 'desc' },
  });
}

export async function getSessionById(sessionId: string) {
  return prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      tenant: { select: { id: true, name: true, phoneNumber: true } },
      messages: {
        orderBy: { timestamp: 'asc' }
      }
    }
  });
}

export async function saveMessage(data: {
  sessionId: string;
  senderType: SenderType;
  content: string;
  mediaUrl?: string;
  wamid?: string | null;
}) {
  return prisma.message.create({
    data: {
      sessionId: data.sessionId,
      senderType: data.senderType,
      content: data.content,
      mediaUrl: data.mediaUrl,
      wamid: data.wamid ?? null,
      status: 'sent',
    },
  });
}

export async function updateSessionStatus(sessionId: string, status: ChatStatus) {
  return prisma.chatSession.update({
    where: { id: sessionId },
    data: { status }
  });
}
