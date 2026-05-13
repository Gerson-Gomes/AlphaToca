"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSocket = initializeSocket;
exports.getIO = getIO;
exports.shutdownSocket = shutdownSocket;
const socket_io_1 = require("socket.io");
const firebase_1 = __importDefault(require("./firebase"));
const userService_1 = require("../services/userService");
const logger_1 = require("./logger");
let io = null;
async function authenticateSocket(socket, next) {
    try {
        const token = socket.handshake.auth?.token;
        if (!token || !token.startsWith('Bearer ')) {
            return next(new Error('Missing or invalid auth token'));
        }
        const jwt = token.split('Bearer ')[1];
        const decoded = await firebase_1.default.auth().verifyIdToken(jwt);
        const user = await userService_1.userService.upsertUserFromFirebase(decoded);
        socket.localUser = user;
        next();
    }
    catch (err) {
        logger_1.logger.error({ err }, '[Socket.IO] authentication failed');
        next(new Error('Invalid token'));
    }
}
function initializeSocket(server) {
    io = new socket_io_1.Server(server, {
        // Migração: Removido adaptador de Redis para simplificar a stack (usando memória local)
        cors: { origin: '*', methods: ['GET', 'POST'] },
        pingInterval: 25000,
        pingTimeout: 20000,
    });
    io.use(authenticateSocket);
    io.on('connection', (socket) => {
        const user = socket.localUser;
        if (!user) {
            socket.disconnect(true);
            return;
        }
        const userId = user.id;
        const role = user.role;
        socket.join(`user:${userId}`);
        if (role === 'LANDLORD') {
            socket.join(`landlord:${userId}`);
        }
        if (role === 'LANDLORD' || role === 'ADMIN') {
            socket.join('provider:all');
        }
        logger_1.logger.info({ userId, role, socketId: socket.id }, '[Socket.IO] client connected (Memory Adapter)');
        socket.on('join_ticket', (ticketId) => {
            socket.join(`ticket:${ticketId}`);
            logger_1.logger.info({ userId, ticketId }, '[Socket.IO] joined ticket room');
        });
        socket.on('leave_ticket', (ticketId) => {
            socket.leave(`ticket:${ticketId}`);
            logger_1.logger.info({ userId, ticketId }, '[Socket.IO] left ticket room');
        });
        socket.on('disconnect', (reason) => {
            socket.leave(`user:${userId}`);
            if (role === 'LANDLORD') {
                socket.leave(`landlord:${userId}`);
            }
            if (role === 'LANDLORD' || role === 'ADMIN') {
                socket.leave('provider:all');
            }
            logger_1.logger.info({ userId, socketId: socket.id, reason }, '[Socket.IO] client disconnected');
        });
    });
    logger_1.logger.info('[Socket.IO] initialized with Native Memory adapter');
    return io;
}
function getIO() {
    if (!io) {
        throw new Error('[Socket.IO] Server not initialized. Call initializeSocket() first.');
    }
    return io;
}
async function shutdownSocket() {
    if (!io)
        return;
    logger_1.logger.info('[Socket.IO] shutting down...');
    await io.close();
    io = null;
    logger_1.logger.info('[Socket.IO] shutdown complete');
}
function setupGracefulShutdown() {
    const shutdown = async (signal) => {
        logger_1.logger.info({ signal }, '[Socket.IO] received signal, shutting down');
        await shutdownSocket();
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
setupGracefulShutdown();
