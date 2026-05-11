import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { produceWhatsAppMessage } from '../services/kafkaProducer';
import { WhatsAppWebhookSchema } from '../schemas/whatsappSchema';
import { updateMessageStatus } from '../services/messageStatusService';
import { verifyMetaSignature } from '../utils/verifyMetaSignature';
import { logger } from '../config/logger';
import prisma from '../config/db';

/**
 * Valida no startup que as variáveis de ambiente necessárias ao webhook
 * estão presentes. Deve ser chamada antes de app.listen() para falhar
 * rápido em caso de configuração ausente.
 */
export function validateWebhookConfig(): void {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!verifyToken || verifyToken.trim() === '') {
        throw new Error(
            '[Webhook] WHATSAPP_VERIFY_TOKEN não configurado. Configure no .env antes de subir o servidor.',
        );
    }
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret || appSecret.trim() === '') {
        throw new Error(
            '[Webhook] META_APP_SECRET não configurado. Obtenha em developers.facebook.com/apps/{id}/settings/basic.',
        );
    }
    logger.info('[webhook] configuration validated');
}

export const verifyWebhook = (req: Request, res: Response) => {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === verifyToken) {
        logger.info('[webhook] verification handshake succeeded');
        res.status(200).send(challenge);
    } else {
        logger.warn({ mode }, '[webhook] verification handshake failed');
        res.sendStatus(403);
    }
};

export const receiveMessage = async (req: Request, res: Response, _next: NextFunction) => {
    try {
        const appSecret = process.env.META_APP_SECRET;
        const isTestEnv = process.env.NODE_ENV === 'test';

        if (!isTestEnv) {
            if (!appSecret) {
                logger.error('[webhook] META_APP_SECRET missing; rejecting request');
                res.status(500).send('EVENT_RECEIVED');
                return;
            }

            const signatureHeader = req.header('x-hub-signature-256');
            if (!verifyMetaSignature(req.rawBody, signatureHeader, appSecret)) {
                logger.warn('[webhook] HMAC signature invalid; request rejected');
                res.status(401).send('EVENT_RECEIVED');
                return;
            }
        }

        const value = req.body?.entry?.[0]?.changes?.[0]?.value;
        if (value?.statuses) {
            logger.info({ statuses: value.statuses }, '[webhook] meta status receipt');
            for (const s of value.statuses as Array<{ id: string; status: 'failed' | 'sent' | 'delivered' | 'read' }>) {
                updateMessageStatus({ id: s.id, status: s.status }).catch((err) => {
                    logger.error({ err, statusId: s.id }, '[webhook] failed to persist status');
                });
            }
            res.sendStatus(200);
            return;
        }

        const payload = WhatsAppWebhookSchema.parse(req.body);

        res.status(200).send('EVENT_RECEIVED');

        if (payload.object === 'whatsapp_business_account') {
            try {
                const phoneNumber = payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id;
                await produceWhatsAppMessage(payload, phoneNumber);
                logger.info(
                    { phoneNumber },
                    '[webhook] message produced to kafka successfully'
                );
            } catch (err) {
                logger.error(
                    { err, phoneNumber: payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id },
                    '[webhook] failed to produce message to kafka'
                );
                // Não retorna erro (webhook já respondeu 200 OK)
                // Kafka tentará novamente na próxima poll
            }
        }
    } catch (error) {
        if (error instanceof ZodError) {
            logger.error(
                { errors: error.errors },
                '[webhook] payload rejected by Zod validation',
            );
            // Persiste payload cru para investigação posterior. Nunca deixar
            // isso bloquear a resposta 200 à Meta (swallow + log on failure).
            prisma.webhookFailure
                .create({
                    data: {
                        source: 'whatsapp',
                        rawBody: req.body ?? {},
                        headers: req.headers as unknown as object,
                        error: JSON.stringify(error.errors),
                    },
                })
                .catch((persistErr) => {
                    logger.error(
                        { err: persistErr },
                        '[webhook] failed to persist webhook_failure',
                    );
                });
            res.status(200).send('EVENT_RECEIVED');
            return;
        }
        logger.error({ err: error }, '[webhook] unexpected error');
        res.status(200).send('EVENT_RECEIVED');
    }
};