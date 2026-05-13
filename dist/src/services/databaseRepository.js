"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseRepository = exports.DatabaseRepository = void 0;
const db_1 = __importDefault(require("../config/db"));
class DatabaseRepository {
    async saveMessage(data) {
        return db_1.default.message.create({
            data: {
                sessionId: data.sessionId,
                senderType: data.senderType,
                content: data.content,
            },
        });
    }
    async getHistory(sessionId, limit) {
        return db_1.default.message.findMany({
            where: { sessionId },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
    }
    async getSession(sessionId) {
        return db_1.default.chatSession.findUnique({
            where: { id: sessionId },
        });
    }
}
exports.DatabaseRepository = DatabaseRepository;
exports.databaseRepository = new DatabaseRepository();
