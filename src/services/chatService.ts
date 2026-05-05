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

export async function listSessions(filters: { tenantId?: string }) {
  return prisma.chatSession.findMany({
    where: filters,
    include: {
      tenant: { select: { id: true, name: true } },
      _count: { select: { messages: true } }
    },
    orderBy: { startedAt: 'desc' }
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
}) {
  return prisma.message.create({
    data: {
      sessionId: data.sessionId,
      senderType: data.senderType,
      content: data.content,
      mediaUrl: data.mediaUrl,
      status: 'sent'
    }
  });
}

export async function updateSessionStatus(sessionId: string, status: ChatStatus) {
  return prisma.chatSession.update({
    where: { id: sessionId },
    data: { status }
  });
}
