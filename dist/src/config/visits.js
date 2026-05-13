"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_VISIT_DURATION_MINUTES = exports.MAX_VISIT_DURATION_MINUTES = exports.MIN_VISIT_DURATION_MINUTES = void 0;
/**
 * Constantes do domínio de visitas. Single source of truth — Zod schema,
 * serviço e janela SQL devem derivar daqui, senão a janela de detecção
 * de conflito fica dessincronizada do máximo permitido pela validação
 * e visitas longas deixam de ser consideradas conflitos silenciosamente.
 */
exports.MIN_VISIT_DURATION_MINUTES = 15;
exports.MAX_VISIT_DURATION_MINUTES = 180;
exports.DEFAULT_VISIT_DURATION_MINUTES = 45;
