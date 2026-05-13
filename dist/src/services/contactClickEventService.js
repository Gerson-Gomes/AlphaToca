"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactClickEventService = void 0;
const db_1 = __importDefault(require("../config/db"));
const logger_1 = require("../config/logger");
exports.contactClickEventService = {
    /**
     * Registra um evento de clique em "Contatar" para um Property. Ao contrário
     * de ProfileView (24h) e PropertyView (1h), NÃO há dedup — analytics de
     * cliques deve contar cada intenção de contato, inclusive a mesma pessoa
     * clicando várias vezes (sinal de alta intenção).
     *
     * Erros de DB são logados e re-propagados: o controller usa este retorno
     * para decidir o status HTTP (201 em sucesso). Diferente do padrão
     * fire-and-forget de view tracking, o cliente está esperando explicitamente
     * o 201 — se o insert falhar, é legítimo retornar 500 para o frontend
     * reportar e tentar de novo.
     */
    async record(propertyId, viewerId = null) {
        try {
            await db_1.default.contactClickEvent.create({
                data: {
                    propertyId,
                    viewerId,
                },
            });
        }
        catch (err) {
            logger_1.logger.error({ err, propertyId, viewerId }, '[contactClickEventService] record failed');
            throw err;
        }
    },
};
