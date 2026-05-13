"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportEmailService = void 0;
const logger_1 = require("../config/logger");
// Modo "dev/off": não chama rede, apenas loga. Ativado quando
// SUPPORT_EMAIL_ENABLED é ausente/'false'/qualquer valor que não seja 'true'.
function isEnabled() {
    return (process.env.SUPPORT_EMAIL_ENABLED ?? 'false').toLowerCase() === 'true';
}
// Endereço do suporte — configurável por env; só é consultado quando habilitado.
function resolveRecipient() {
    return process.env.SUPPORT_EMAIL_TO ?? 'support@imoveis.local';
}
function buildCreatedEnvelope(ticket) {
    return {
        to: resolveRecipient(),
        subject: `[Suporte I-Moveis] Novo chamado ${ticket.code}: ${ticket.title}`,
        body: `Protocolo: ${ticket.code}\n` +
            `Título: ${ticket.title}\n` +
            `Aberto por: ${ticket.userName} (${ticket.userRole})\n` +
            `Descrição:\n${ticket.description}`,
        ticketId: ticket.id,
        ticketCode: ticket.code,
    };
}
function buildUpdatedEnvelope(ticket) {
    return {
        to: resolveRecipient(),
        subject: `[Suporte I-Moveis] Chamado ${ticket.code} atualizado (status=${ticket.status})`,
        body: `Protocolo: ${ticket.code}\n` +
            `Status atual: ${ticket.status}\n` +
            `Aberto por: ${ticket.userName} (${ticket.userRole})\n` +
            (ticket.resolution ? `Resolução:\n${ticket.resolution}\n` : ''),
        ticketId: ticket.id,
        ticketCode: ticket.code,
    };
}
exports.supportEmailService = {
    /**
     * Notifica o canal de suporte sobre a abertura de um novo ticket.
     * - SUPPORT_EMAIL_ENABLED != 'true': loga o envelope que seria enviado e retorna.
     * - SUPPORT_EMAIL_ENABLED == 'true' e `transport` injetado: chama `transport.send(envelope)` uma vez.
     * - SUPPORT_EMAIL_ENABLED == 'true' e nenhum transport: loga um TODO (integração real pendente).
     *
     * NUNCA lança — o caller (POST /api/support/tickets) já trata a falha como não-fatal,
     * mas a garantia aqui simplifica a vida de quem reusar este serviço.
     */
    async sendTicketCreated(ticket, transport) {
        const envelope = buildCreatedEnvelope(ticket);
        if (!isEnabled()) {
            logger_1.logger.info({ ticketId: ticket.id, code: ticket.code, envelope }, 'supportEmail disabled — would send ticket-created envelope');
            return;
        }
        if (!transport) {
            // TODO: integrar com a infra de email do projeto (nodemailer/SES/Resend)
            // quando estiver disponível. Até lá, mantemos o side-effect como log para
            // facilitar debug em homolog.
            logger_1.logger.warn({ ticketId: ticket.id, code: ticket.code, envelope }, 'supportEmail enabled but no transport injected — skipping real send');
            return;
        }
        try {
            await transport.send(envelope);
        }
        catch (err) {
            logger_1.logger.error({ err, ticketId: ticket.id, code: ticket.code }, 'supportEmail transport.send failed on ticket-created');
        }
    },
    /**
     * Notifica o canal de suporte sobre uma atualização relevante de ticket
     * (status/resolução/assignee). Mesmas regras de gating que `sendTicketCreated`.
     */
    async sendTicketUpdated(ticket, transport) {
        const envelope = buildUpdatedEnvelope(ticket);
        if (!isEnabled()) {
            logger_1.logger.info({ ticketId: ticket.id, code: ticket.code, envelope }, 'supportEmail disabled — would send ticket-updated envelope');
            return;
        }
        if (!transport) {
            // TODO: integrar com a infra de email do projeto quando disponível.
            logger_1.logger.warn({ ticketId: ticket.id, code: ticket.code, envelope }, 'supportEmail enabled but no transport injected — skipping real send');
            return;
        }
        try {
            await transport.send(envelope);
        }
        catch (err) {
            logger_1.logger.error({ err, ticketId: ticket.id, code: ticket.code }, 'supportEmail transport.send failed on ticket-updated');
        }
    },
};
