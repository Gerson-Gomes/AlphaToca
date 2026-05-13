"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rentalProcessService = void 0;
const db_1 = __importDefault(require("../config/db"));
const pushNotificationService_1 = require("./pushNotificationService");
const logger_1 = require("../config/logger");
// ---------------------------------------------------------------------------
// Mapeamento de rótulos legíveis para cada etapa do processo
// ---------------------------------------------------------------------------
const STAGE_LABELS = {
    TRIAGE: 'Triagem',
    VISIT_SCHEDULED: 'Visita Agendada',
    CONTRACT_ANALYSIS: 'Análise de Contrato',
    CLOSED: 'Processo Encerrado',
};
// ---------------------------------------------------------------------------
// Serviço de Processo de Locação
// ---------------------------------------------------------------------------
exports.rentalProcessService = {
    async getById(id) {
        return db_1.default.rentalProcess.findUnique({ where: { id } });
    },
    async listByTenant(tenantId) {
        return db_1.default.rentalProcess.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
        });
    },
    /**
     * Cria um novo processo de locação para um inquilino.
     * Status inicial: TRIAGE (definido pelo schema como default).
     */
    async create(tenantId, propertyId) {
        return db_1.default.rentalProcess.create({
            data: { tenantId, propertyId: propertyId ?? null },
        });
    },
    /**
     * Atualiza o status de um processo de locação.
     *
     * Gatilhos de notificação:
     * - Qualquer avanço de etapa → RENTAL_STAGE_CHANGED (inquilino)
     * - Status → CLOSED          → RENTAL_CLOSED (inquilino + locador do imóvel)
     *
     * Efeito colateral de lifecycle (US-005):
     *   quando o processo transita para CLOSED (estado terminal) e o imóvel
     *   ainda estava em negociação (NEGOTIATING) sem contrato ativo, a mesma
     *   transação devolve Property.status para AVAILABLE. Se o imóvel já estiver
     *   RENTED (contrato ACTIVE), a limpeza fica a cargo de
     *   contractService.updateContractStatus.
     */
    async updateStatus(id, newStatus) {
        const existing = await db_1.default.rentalProcess.findUnique({
            where: { id },
            include: {
                tenant: { select: { id: true, fcmToken: true } },
                property: {
                    select: {
                        id: true,
                        title: true,
                        status: true,
                        landlord: { select: { id: true, fcmToken: true } },
                    },
                },
            },
        });
        if (!existing)
            return null;
        if (existing.status === newStatus)
            return existing; // sem mudança, sem notificação
        const shouldReleaseProperty = newStatus === 'CLOSED' &&
            existing.property?.id !== undefined &&
            existing.property?.status === 'NEGOTIATING';
        const updated = await db_1.default.$transaction(async (tx) => {
            const updatedRp = await tx.rentalProcess.update({
                where: { id },
                data: { status: newStatus },
            });
            if (shouldReleaseProperty && existing.property) {
                await tx.property.update({
                    where: { id: existing.property.id },
                    data: { status: 'AVAILABLE' },
                });
            }
            return updatedRp;
        });
        const stageLabel = STAGE_LABELS[newStatus];
        const propertyTitle = existing.property?.title ?? 'imóvel';
        const tenantId = existing.tenant.id;
        const tenantFcmToken = existing.tenant.fcmToken;
        if (newStatus === 'CLOSED') {
            // Notifica o inquilino — processo encerrado
            pushNotificationService_1.pushNotificationService.notify({
                userId: tenantId,
                fcmToken: tenantFcmToken,
                type: 'RENTAL_CLOSED',
                title: 'Processo de Locação Concluído',
                body: `O processo do imóvel "${propertyTitle}" foi finalizado com sucesso.`,
                data: { rentalProcessId: id, type: 'RENTAL_CLOSED' },
            }).catch((err) => logger_1.logger.error({ err, rentalProcessId: id }, '[rentalProcessService] Falha ao notificar inquilino sobre RENTAL_CLOSED'));
            // Notifica o locador — processo encerrado
            const landlord = existing.property?.landlord;
            if (landlord) {
                pushNotificationService_1.pushNotificationService.notify({
                    userId: landlord.id,
                    fcmToken: landlord.fcmToken,
                    type: 'RENTAL_CLOSED',
                    title: 'Processo de Locação Concluído',
                    body: `O processo do imóvel "${propertyTitle}" foi finalizado com sucesso.`,
                    data: { rentalProcessId: id, type: 'RENTAL_CLOSED' },
                }).catch((err) => logger_1.logger.error({ err, rentalProcessId: id }, '[rentalProcessService] Falha ao notificar locador sobre RENTAL_CLOSED'));
            }
        }
        else {
            // Notifica o inquilino — avanço de etapa
            pushNotificationService_1.pushNotificationService.notify({
                userId: tenantId,
                fcmToken: tenantFcmToken,
                type: 'RENTAL_STAGE_CHANGED',
                title: 'Processo Avançou de Etapa!',
                body: `Seu processo de locação do imóvel "${propertyTitle}" avançou para: ${stageLabel}.`,
                data: { rentalProcessId: id, type: 'RENTAL_STAGE_CHANGED' },
            }).catch((err) => logger_1.logger.error({ err, rentalProcessId: id }, '[rentalProcessService] Falha ao notificar inquilino sobre RENTAL_STAGE_CHANGED'));
        }
        return updated;
    },
};
