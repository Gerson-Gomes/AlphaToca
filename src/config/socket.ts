import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import admin from './firebase';
import { userService } from '../services/userService';
import { logger } from './logger';

let io: Server | null = null;

async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token || !token.startsWith('Bearer ')) {
      return next(new Error('Missing or invalid auth token'));
    }

    const jwt = token.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(jwt);

    const user = await userService.upsertUserFromFirebase(decoded);
    (socket as any).localUser = user;

    next();
  } catch (err) {
    logger.error({ err }, '[Socket.IO] authentication failed');
    next(new Error('Invalid token'));
  }
}

export function initializeSocket(server: HttpServer): Server {
  io = new Server(server, {
    // Migração: Removido adaptador de Redis para simplificar a stack (usando memória local)
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(authenticateSocket);

  io.on('connection', (socket: Socket) => {
    const user = (socket as any).localUser;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    const userId = user.id;
    const role = user.role as string;

    socket.join(`user:${userId}`);

    if (role === 'LANDLORD') {
      socket.join(`landlord:${userId}`);
    }

    if (role === 'LANDLORD' || role === 'ADMIN') {
      socket.join('provider:all');
    }

    logger.info(
      { userId, role, socketId: socket.id },
      '[Socket.IO] client connected (Memory Adapter)',
    );

    socket.on('join_ticket', (ticketId: string) => {
      socket.join(`ticket:${ticketId}`);
      logger.info({ userId, ticketId }, '[Socket.IO] joined ticket room');
    });

    socket.on('leave_ticket', (ticketId: string) => {
      socket.leave(`ticket:${ticketId}`);
      logger.info({ userId, ticketId }, '[Socket.IO] left ticket room');
    });

    socket.on('disconnect', (reason) => {
      socket.leave(`user:${userId}`);
      if (role === 'LANDLORD') {
        socket.leave(`landlord:${userId}`);
      }
      if (role === 'LANDLORD' || role === 'ADMIN') {
        socket.leave('provider:all');
      }
      logger.info(
        { userId, socketId: socket.id, reason },
        '[Socket.IO] client disconnected',
      );
    });
  });

  logger.info('[Socket.IO] initialized with Native Memory adapter');
  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error('[Socket.IO] Server not initialized. Call initializeSocket() first.');
  }
  return io;
}

export async function shutdownSocket(): Promise<void> {
  if (!io) return;
  logger.info('[Socket.IO] shutting down...');
  await io.close();
  io = null;
  logger.info('[Socket.IO] shutdown complete');
}

function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, '[Socket.IO] received signal, shutting down');
    await shutdownSocket();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

setupGracefulShutdown();
