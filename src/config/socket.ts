import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import admin from './firebase';
import { userService } from '../services/userService';
import { logger } from './logger';

let io: Server | null = null;

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  throw new Error('[Socket.IO] REDIS_URL não definida no ambiente.');
}

const pubClient = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => logger.error({ err }, '[Socket.IO] pubClient error'));
subClient.on('error', (err) => logger.error({ err }, '[Socket.IO] subClient error'));

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
    adapter: createAdapter(pubClient, subClient),
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

    socket.join('provider:all');

    logger.info(
      { userId, role, socketId: socket.id },
      '[Socket.IO] client connected',
    );

    socket.on('disconnect', (reason) => {
      logger.info(
        { userId, socketId: socket.id, reason },
        '[Socket.IO] client disconnected',
      );
    });

    socket.on('error', (err) => {
      logger.error(
        { err, userId, socketId: socket.id },
        '[Socket.IO] socket error',
      );
    });
  });

  logger.info('[Socket.IO] initialized with Redis adapter');
  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error('[Socket.IO] Server not initialized. Call initializeSocket() first.');
  }
  return io;
}

export { pubClient, subClient };
