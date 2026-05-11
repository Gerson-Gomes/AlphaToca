import prisma from '../config/db';
import { Message, ChatSession } from '@prisma/client';

export interface IDatabaseRepository {
  saveMessage(data: { sessionId: string; senderType: 'BOT' | 'TENANT' | 'LANDLORD'; content: string }): Promise<Message>;
  getHistory(sessionId: string, limit: number): Promise<Message[]>;
  getSession(sessionId: string): Promise<ChatSession | null>;
}

export class DatabaseRepository implements IDatabaseRepository {
  async saveMessage(data: { sessionId: string; senderType: 'BOT' | 'TENANT' | 'LANDLORD'; content: string }): Promise<Message> {
    return prisma.message.create({
      data: {
        sessionId: data.sessionId,
        senderType: data.senderType,
        content: data.content,
      },
    });
  }

  async getHistory(sessionId: string, limit: number): Promise<Message[]> {
    return prisma.message.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    return prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
  }
}

export const databaseRepository = new DatabaseRepository();
