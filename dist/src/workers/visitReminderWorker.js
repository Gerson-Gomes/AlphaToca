"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleReminders = scheduleReminders;
const db_1 = __importDefault(require("../config/db"));
const kafkaProducer_1 = require("../services/kafkaProducer");
const pushNotificationService_1 = require("../services/pushNotificationService");
const logger_1 = require("../config/logger");
/**
 * Worker de Lembretes de Visita (Migrado para Kafka)
 *
 * Roda via cron job a cada hora (veja scheduleReminders abaixo).
 * A cada execução, busca visitas com status SCHEDULED que ocorrem:
 *   - Em aproximadamente 24 horas (janela: 23h30 a 24h30)
 *   - Em aproximadamente 2 horas  (janela: 1h30 a 2h30)
 *
 * Para cada visita encontrada, produz eventos VISIT_REMINDER para Kafka.
 * O Kafka consumer (kafkaConsumer.ts) processa esses eventos e dispara notificações.
 *
 * Idempotência: A janela de ±30 minutos garante que o job horário nunca perca
 * uma visita, mas pode processar a mesma visita duas vezes se o cron atrasar.
 * Isso é aceitável — duplicar um lembrete é menos grave que não enviá-lo.
 */
// Janela de ±30 min em torno do horário alvo para garantir cobertura entre execuções horárias
const WINDOW_MS = 30 * 60 * 1000;
async function sendRemindersForWindow(targetHours) {
    const now = new Date();
    const targetMs = targetHours * 60 * 60 * 1000;
    const windowStart = new Date(now.getTime() + targetMs - WINDOW_MS);
    const windowEnd = new Date(now.getTime() + targetMs + WINDOW_MS);
    const visits = await db_1.default.visit.findMany({
        where: {
            status: 'SCHEDULED',
            scheduledAt: { gte: windowStart, lte: windowEnd },
        },
        include: {
            tenant: { select: { id: true, fcmToken: true } },
            landlord: { select: { id: true, fcmToken: true } },
            property: { select: { title: true } },
        },
    });
    if (visits.length === 0) {
        logger_1.logger.info(`[ReminderWorker] Nenhuma visita encontrada para a janela de ${targetHours}h.`);
        return;
    }
    logger_1.logger.info(`[ReminderWorker] ${visits.length} visita(s) encontrada(s) para lembrete de ${targetHours}h.`);
    const timeLabel = targetHours === 24 ? 'amanhã' : 'em 2 horas';
    const scheduledAtFormatted = (date) => date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const promises = visits.flatMap((visit) => {
        const propertyTitle = visit.property?.title ?? 'imóvel';
        const dateLabel = scheduledAtFormatted(visit.scheduledAt);
        const data = {
            visitId: visit.id,
            propertyId: visit.propertyId,
            type: 'VISIT_REMINDER',
        };
        return [
            // Lembrete para o inquilino
            pushNotificationService_1.pushNotificationService.notify({
                userId: visit.tenant.id,
                fcmToken: visit.tenant.fcmToken,
                type: 'VISIT_REMINDER',
                title: `Lembrete: Visita ${timeLabel}!`,
                body: `Você tem uma visita ao imóvel "${propertyTitle}" agendada para ${dateLabel}.`,
                data,
            }).catch((err) => logger_1.logger.error({ err, visitId: visit.id }, '[ReminderWorker] Falha ao notificar inquilino')),
            // Lembrete para o locador
            pushNotificationService_1.pushNotificationService.notify({
                userId: visit.landlord.id,
                fcmToken: visit.landlord.fcmToken,
                type: 'VISIT_REMINDER',
                title: `Lembrete: Visita ao seu imóvel ${timeLabel}!`,
                body: `Uma visita ao imóvel "${propertyTitle}" está agendada para ${dateLabel}.`,
                data,
            }).catch((err) => logger_1.logger.error({ err, visitId: visit.id }, '[ReminderWorker] Falha ao notificar locador')),
        ];
    });
    await Promise.allSettled(promises);
}
/**
 * Produz eventos de lembrete de visita para Kafka
 * Disparado a cada hora pelo agendador (cron)
 */
async function produceReminderEvents() {
    try {
        // Usar timestamp para garantir keys únicas (Kafka exige keys para particionamento)
        const timestamp = Date.now();
        // Produzir evento para lembrete de 24h
        await (0, kafkaProducer_1.produceVisitReminder)({ windowHours: 24 }, `reminder-24h-${timestamp}`);
        logger_1.logger.info('[visit-reminder-worker] 24h reminder event produced to kafka');
        // Produzir evento para lembrete de 2h
        await (0, kafkaProducer_1.produceVisitReminder)({ windowHours: 2 }, `reminder-2h-${timestamp}`);
        logger_1.logger.info('[visit-reminder-worker] 2h reminder event produced to kafka');
    }
    catch (err) {
        logger_1.logger.error({ err }, '[visit-reminder-worker] failed to produce reminder events to kafka');
        // Falha será retentada na próxima execução do cron (1 hora depois)
    }
}
/**
 * Agenda a produção de eventos de lembrete de visita
 * Dispara imediatamente e repete a cada hora
 */
async function scheduleReminders() {
    // Execução imediata
    await produceReminderEvents().catch((err) => {
        logger_1.logger.error({ err }, '[visit-reminder-worker] failed on initial schedule attempt');
    });
    // Repetir a cada 1 hora
    setInterval(async () => {
        await produceReminderEvents().catch((err) => {
            logger_1.logger.error({ err }, '[visit-reminder-worker] failed on scheduled attempt');
        });
    }, 60 * 60 * 1000 // 1 hora em ms
    );
    logger_1.logger.info('[visit-reminder-worker] reminder scheduler started (executes every hour)');
}
