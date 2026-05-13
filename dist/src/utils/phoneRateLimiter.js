"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPhoneRateLimit = checkPhoneRateLimit;
const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW = 60;
/**
 * Rate limit por phoneNumber usando Redis INCR + EXPIRE.
 *
 * A primeira mensagem numa janela de `windowSeconds` seta a TTL;
 * mensagens subsequentes apenas incrementam o contador. Quando o
 * contador passa de `limit`, a função retorna `allowed: false` e o
 * caller deve pular o processamento (ou enviar uma mensagem de
 * aviso ao usuário).
 *
 * Usa keys TTL-isoladas por phoneNumber — não segura nenhuma conexão,
 * não bloqueia, operação atômica no Redis.
 */
async function checkPhoneRateLimit(redis, phoneNumber, options = {}) {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW;
    const prefix = options.keyPrefix ?? 'rl:phone';
    const key = `${prefix}:${phoneNumber}`;
    const count = await redis.incr(key);
    if (count === 1) {
        await redis.expire(key, windowSeconds);
    }
    if (count > limit) {
        const ttl = await redis.ttl(key);
        return {
            allowed: false,
            count,
            limit,
            retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
        };
    }
    return { allowed: true, count, limit, retryAfterSeconds: 0 };
}
