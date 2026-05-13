"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
/**
 * Logger estruturado do AlphaToca.
 *
 * - Em desenvolvimento (NODE_ENV != production), usa pino-pretty para output colorido.
 * - Em produção, emite JSON puro (ingestável por Loki, CloudWatch, Datadog, etc).
 * - Nível configurável via LOG_LEVEL (default 'info'; em testes, 'silent').
 *
 * Use `logger.child({ requestId, jobId, wamid })` para propagar correlation IDs.
 */
function resolveLevel() {
    if (process.env.LOG_LEVEL)
        return process.env.LOG_LEVEL;
    if (process.env.NODE_ENV === 'test')
        return 'silent';
    return 'info';
}
function buildLogger() {
    const level = resolveLevel();
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
        return (0, pino_1.default)({ level });
    }
    return (0, pino_1.default)({
        level,
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:HH:MM:ss',
                ignore: 'pid,hostname',
            },
        },
    });
}
exports.logger = buildLogger();
