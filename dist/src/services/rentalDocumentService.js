"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rentalDocumentService = void 0;
const db_1 = __importDefault(require("../config/db"));
const pushNotificationService_1 = require("./pushNotificationService");
const logger_1 = require("../config/logger");
// ---------------------------------------------------------------------------
// Rótulos legíveis para cada tipo de documento
// ---------------------------------------------------------------------------
const DOCUMENT_LABELS = {
    IDENTITY: 'Documento de Identidade',
    INCOME_PROOF: 'Comprovante de Renda',
    CONTRACT: 'Contrato',
};
// ---------------------------------------------------------------------------
// Serviço de Documentos de Locação
// ---------------------------------------------------------------------------
exports.rentalDocumentService = {
    async getById(id) {
        return db_1.default.rentalDocument.findUnique({ where: { id } });
    },
    async listByProcess(rentalProcessId) {
        return db_1.default.rentalDocument.findMany({ where: { rentalProcessId } });
    },
    /**
     * Solicita um documento ao inquilino.
     * Persiste o registro de documento e notifica o inquilino.
     *
     * Gatilho: DOCUMENT_REQUESTED → inquilino
     */
    async requestDocument(rentalProcessId, documentType, fileUrl) {
        // Busca o tenantId via processo de locação
        const process = await db_1.default.rentalProcess.findUnique({
            where: { id: rentalProcessId },
            include: { tenant: { select: { id: true, fcmToken: true } } },
        });
        if (!process) {
            throw new Error(`RentalProcess não encontrado: ${rentalProcessId}`);
        }
        const document = await db_1.default.rentalDocument.create({
            data: { rentalProcessId, documentType, fileUrl },
        });
        const docLabel = DOCUMENT_LABELS[documentType];
        // Notifica o inquilino sobre o documento solicitado
        pushNotificationService_1.pushNotificationService.notify({
            userId: process.tenant.id,
            fcmToken: process.tenant.fcmToken,
            type: 'DOCUMENT_REQUESTED',
            title: 'Documento Pendente',
            body: `Precisamos do seu ${docLabel} para continuar o processo de locação.`,
            data: {
                rentalProcessId,
                documentType,
                documentId: document.id,
                type: 'DOCUMENT_REQUESTED',
            },
        }).catch((err) => logger_1.logger.error({ err, rentalProcessId, documentType }, '[rentalDocumentService] Falha ao notificar inquilino sobre DOCUMENT_REQUESTED'));
        return document;
    },
    /**
     * Rejeita um documento enviado pelo inquilino e solicita reenvio.
     * Notifica o inquilino com o motivo da rejeição.
     *
     * Gatilho: DOCUMENT_REJECTED → inquilino
     */
    async rejectDocument(documentId, reason) {
        const document = await db_1.default.rentalDocument.findUnique({
            where: { id: documentId },
            include: {
                rentalProcess: {
                    include: { tenant: { select: { id: true, fcmToken: true } } },
                },
            },
        });
        if (!document)
            return null;
        const docLabel = DOCUMENT_LABELS[document.documentType];
        const tenant = document.rentalProcess.tenant;
        const rejectionReason = reason ?? 'O documento está ilegível ou inválido.';
        // Notifica o inquilino sobre a rejeição
        pushNotificationService_1.pushNotificationService.notify({
            userId: tenant.id,
            fcmToken: tenant.fcmToken,
            type: 'DOCUMENT_REJECTED',
            title: 'Documento Rejeitado',
            body: `Seu ${docLabel} foi rejeitado. Motivo: ${rejectionReason} Por favor, reenvie.`,
            data: {
                rentalProcessId: document.rentalProcessId,
                documentType: document.documentType,
                documentId,
                type: 'DOCUMENT_REJECTED',
            },
        }).catch((err) => logger_1.logger.error({ err, documentId, documentType: document.documentType }, '[rentalDocumentService] Falha ao notificar inquilino sobre DOCUMENT_REJECTED'));
        return document;
    },
};
