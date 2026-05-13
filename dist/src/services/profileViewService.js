"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileViewService = void 0;
const db_1 = __importDefault(require("../config/db"));
const logger_1 = require("../config/logger");
// Dedup window para viewers autenticados: F5 do mesmo usuário logado dentro de
// 24h não incrementa o contador. Visitantes anônimos (viewerId=null) sempre
// inserem linha — sem identidade estável não dá para deduplicar.
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
exports.profileViewService = {
    /**
     * Registra uma abertura do perfil público do landlord. Chamada fire-and-forget
     * pelo controller — erros são logados mas não propagados, porque uma falha no
     * tracking não deve derrubar o GET da propriedade.
     *
     * Regras (LL-001):
     *   - viewerId null (anônimo): sempre insere uma linha.
     *   - viewerId não-null: verifica se já existe uma linha (landlordId, viewerId)
     *     dentro da janela de 24h. Se sim, não insere. Se não, insere.
     */
    async record(landlordId, viewerId = null) {
        try {
            if (viewerId) {
                const since = new Date(Date.now() - DEDUP_WINDOW_MS);
                const recent = await db_1.default.profileView.findFirst({
                    where: {
                        landlordId,
                        viewerId,
                        viewedAt: { gte: since },
                    },
                    select: { id: true },
                });
                if (recent)
                    return;
            }
            await db_1.default.profileView.create({
                data: {
                    landlordId,
                    viewerId,
                },
            });
        }
        catch (err) {
            logger_1.logger.error({ err, landlordId, viewerId }, '[profileViewService] record failed');
        }
    },
};
