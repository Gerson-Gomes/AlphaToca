"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.propertyViewService = void 0;
const db_1 = __importDefault(require("../config/db"));
const logger_1 = require("../config/logger");
// Dedup window para viewers autenticados em eventos de visualização de imóvel.
// 1h (mais curto que o 24h do ProfileView, LL-001) porque a granularidade do
// gráfico é diária — F5 agressivo na mesma sessão não deve inflar o bucket do
// dia, mas retornos dentro do mesmo dia após uma pausa são legítimos.
// Anônimos (viewerId=null) sempre inserem — sem identidade estável não dá
// para deduplicar.
const DEDUP_WINDOW_MS = 60 * 60 * 1000;
exports.propertyViewService = {
    /**
     * Registra um evento de visualização de Property. Chamada fire-and-forget
     * pelo controller — erros são logados mas não propagados, porque uma falha
     * no tracking não deve derrubar o GET da propriedade.
     *
     * Regras (LL-006):
     *   - viewerId null (anônimo): sempre insere uma linha + incrementa
     *     Property.views.
     *   - viewerId não-null: verifica se já existe uma linha
     *     (propertyId, viewerId) dentro da janela de 1h. Se sim, não insere
     *     e NÃO incrementa o contador. Se não, insere e incrementa.
     *
     * O contador agregado `Property.views` é preservado (FR-12) para manter o
     * ordering `orderBy=views` no search existente; a série diária vem do
     * novo evento.
     */
    async record(propertyId, viewerId = null) {
        try {
            if (viewerId) {
                const since = new Date(Date.now() - DEDUP_WINDOW_MS);
                const recent = await db_1.default.propertyViewEvent.findFirst({
                    where: {
                        propertyId,
                        viewerId,
                        viewedAt: { gte: since },
                    },
                    select: { id: true },
                });
                if (recent)
                    return;
            }
            await db_1.default.propertyViewEvent.create({
                data: {
                    propertyId,
                    viewerId,
                },
            });
            await db_1.default.property.update({
                where: { id: propertyId },
                data: { views: { increment: 1 } },
            });
        }
        catch (err) {
            logger_1.logger.error({ err, propertyId, viewerId }, '[propertyViewService] record failed');
        }
    },
};
