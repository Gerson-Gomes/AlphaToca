import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import type { ChatSession, PrismaClient } from '@prisma/client';
import { WhatsAppWebhookPayload } from '../types/whatsapp';
import prisma from '../config/db';
import { sendMessage as defaultSendMessage, SendMessageResponse } from '../services/whatsappService';
import { generateAnswer as defaultGenerateAnswer, GenerateAnswerResult } from '../services/ragChainService';
import { extractInsights as defaultExtractInsights, ExtractInsightsResult } from '../services/leadExtractionService';
import { extractSearchFilters as defaultExtractSearchFilters, buildSearchResponse, type SearchFilters } from '../services/searchExtractionService';
import { propertyService } from '../services/propertyService';
import type { PropertySearchInput } from '../utils/searchValidation';
import { logger, type Logger } from '../config/logger';
import { checkPhoneRateLimit, type PhoneRateLimitResult } from '../utils/phoneRateLimiter';

export const RAG_ERROR_FALLBACK =
    'Desculpe, tive um problema técnico para responder agora. Um de nossos atendentes humanos vai continuar esse atendimento em instantes.';

export const RATE_LIMIT_REPLY =
    'Você enviou várias mensagens muito rápido. Aguarde alguns instantes e tente novamente, por favor.';

export const NON_TEXT_REPLY =
    'Por enquanto só consigo entender mensagens de texto. Pode me mandar sua dúvida escrita, por favor?';

export const WELCOME_MESSAGE =
    'Olá! Seja bem-vindo(a) ao I-Moveis. Sou seu assistente virtual e estou aqui para ajudar com o que precisar sobre aluguel de imóveis. Como posso te auxiliar hoje?';

const GREETING_REGEX = /^(oi|olá|oie|oii|ola|bom dia|boa tarde|boa noite|e aí|eai|fala|falaí|fala ai)[!.]*\s*$/i;

export const LEAD_EXTRACTION_CONCURRENCY = Number(process.env.LEAD_EXTRACTION_CONCURRENCY ?? 3);

export const PHONE_RATE_LIMIT = Number(process.env.PHONE_RATE_LIMIT ?? 10);
export const PHONE_RATE_WINDOW_SECONDS = Number(process.env.PHONE_RATE_WINDOW_SECONDS ?? 60);

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export function isSessionExpired(
    session: { expiresAt?: Date | null } | null | undefined,
    now: Date = new Date(),
): boolean {
    if (!session || !session.expiresAt) return false;
    return session.expiresAt.getTime() <= now.getTime();
}

export interface ConcurrencyLimiter {
    run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
    let active = 0;
    const waiters: Array<() => void> = [];
    return {
        async run<T>(fn: () => Promise<T>): Promise<T> {
            if (active >= max) {
                await new Promise<void>((resolve) => waiters.push(resolve));
            } else {
                active++;
            }
            try {
                return await fn();
            } finally {
                const next = waiters.shift();
                if (next) {
                    next();
                } else {
                    active--;
                }
            }
        },
    };
}

const defaultLeadExtractionLimiter = createConcurrencyLimiter(LEAD_EXTRACTION_CONCURRENCY);

type PrismaWorkerClient = Pick<PrismaClient, 'user' | 'chatSession' | 'message'>;

type SendMessageFn = (to: string, text: string) => Promise<SendMessageResponse>;

type GenerateAnswerFn = (input: {
    sessionId: string;
    userMessage: string;
}) => Promise<GenerateAnswerResult>;

type ExtractInsightsFn = (input: {
    sessionId: string;
    userMessage: string;
}) => Promise<ExtractInsightsResult>;

export type PhoneRateLimitCheck = (phoneNumber: string) => Promise<PhoneRateLimitResult>;

type ExtractSearchFiltersFn = (userMessage: string) => Promise<SearchFilters>;

type SearchPropertiesFn = typeof propertyService.searchProperties;

export interface WhatsappHandlerDeps {
    prisma: PrismaWorkerClient;
    sendMessage: SendMessageFn;
    generateAnswer: GenerateAnswerFn;
    extractInsights: ExtractInsightsFn;
    extractSearchFilters: ExtractSearchFiltersFn;
    searchProperties: SearchPropertiesFn;
    appBaseUrl: string;
    scheduleMicrotask?: (task: () => void) => void;
    leadExtractionLimiter?: ConcurrencyLimiter;
    log?: Logger;
    checkRateLimit?: PhoneRateLimitCheck;
    emitEvent?: (event: string, data: any) => Promise<void>;
}

export interface WhatsappHandlerResult {
    success: boolean;
    reason?: string;
    handoff?: boolean;
    ragError?: boolean;
}

export async function handleWhatsappMessage(
    payload: WhatsAppWebhookPayload,
    deps: WhatsappHandlerDeps,
): Promise<WhatsappHandlerResult> {
    const log = deps.log ?? logger;
    const changeValue = (payload as any).entry?.[0]?.changes?.[0]?.value;
    if (!changeValue) {
        return { success: true, reason: 'ignored_empty_changes' };
    }

    const contact = changeValue.contacts?.[0];
    const message = changeValue.messages?.[0];

    if (!message || !contact) {
        return { success: true, reason: 'ignored_not_message' };
    }

    const wamid: string = message.id;
    if (wamid) {
        const existing = await deps.prisma.message.findUnique({ where: { wamid } });
        if (existing) {
            log.info({ wamid }, '[worker] duplicate wamid; skipping');
            return { success: true, reason: 'duplicate_wamid' };
        }
    }

    const phoneNumber = contact.wa_id;
    const contactName = contact.profile?.name || 'Lead';

    // Hoje o bot só processa texto. Para qualquer outro tipo (image, audio,
    // sticker, location, unsupported…), respondemos com uma mensagem padrão
    // pedindo texto e encerramos — sem persistir nada, sem chamar RAG.
    const messageBody = message.text?.body;
    if (message.type !== 'text' || !messageBody) {
        log.info(
            { phoneNumber, type: message.type },
            '[worker] non-text message received; sending default reply',
        );
        try {
            await deps.sendMessage(phoneNumber, NON_TEXT_REPLY);
        } catch (err) {
            log.error({ err }, '[worker] failed to send non-text reply');
        }
        return { success: true, reason: 'non_text_message' };
    }

    const messageText = messageBody;

    if (deps.checkRateLimit) {
        const rl = await deps.checkRateLimit(phoneNumber);
        if (!rl.allowed) {
            log.warn(
                { phoneNumber, count: rl.count, limit: rl.limit, retryAfterSeconds: rl.retryAfterSeconds },
                '[worker] phone rate limit exceeded',
            );
            try {
                await deps.sendMessage(phoneNumber, RATE_LIMIT_REPLY);
            } catch (err) {
                log.error({ err }, '[worker] failed to send rate-limit reply');
            }
            return { success: true, reason: 'rate_limited' };
        }
    }

    const user = await deps.prisma.user.upsert({
        where: { phoneNumber },
        update: { name: contactName },
        create: {
            phoneNumber,
            name: contactName,
            role: 'TENANT',
        },
    });

    const previousSession = await deps.prisma.chatSession.findFirst({
        where: { tenantId: user.id },
        orderBy: { startedAt: 'desc' },
    });

    const expired = isSessionExpired(previousSession);
    const isNewOrResetSession = !previousSession || previousSession.status !== 'ACTIVE_BOT' || expired;

    if (isNewOrResetSession && previousSession) {
        log.info(
            {
                sessionId: previousSession.id,
                reason: expired ? 'expired' : 'inactive',
                previousStatus: previousSession.status,
                expiresAt: previousSession.expiresAt?.toISOString?.() ?? null,
            },
            '[worker] replacing inactive session with new ACTIVE_BOT',
        );
    }

    const chatSession: ChatSession = isNewOrResetSession
        ? await deps.prisma.chatSession.create({
              data: {
                  tenantId: user.id,
                  status: 'ACTIVE_BOT',
                  expiresAt: new Date(Date.now() + SESSION_TTL_MS),
              },
          })
        : previousSession;

    const tenantMsg = await deps.prisma.message.create({
        data: {
            wamid: wamid || null,
            sessionId: chatSession.id,
            senderType: 'TENANT',
            content: messageText,
        },
    });

    await deps.emitEvent?.('new_message', {
        tenantId: user.id,
        sessionId: chatSession.id,
        message: {
            id: tenantMsg.id,
            sessionId: chatSession.id,
            senderType: 'TENANT',
            content: messageText,
            status: 'sent',
            timestamp: tenantMsg.timestamp,
            wamid: wamid || null,
        },
    });

    if (isNewOrResetSession && GREETING_REGEX.test(messageText.trim())) {
        try {
            await deps.sendMessage(phoneNumber, WELCOME_MESSAGE);
            const welcomeMsg = await deps.prisma.message.create({
                data: {
                    sessionId: chatSession.id,
                    senderType: 'BOT',
                    content: WELCOME_MESSAGE,
                },
            });

            await deps.emitEvent?.('new_message', {
                tenantId: user.id,
                sessionId: chatSession.id,
                message: {
                    id: welcomeMsg.id,
                    sessionId: chatSession.id,
                    senderType: 'BOT',
                    content: WELCOME_MESSAGE,
                    status: 'sent',
                    timestamp: welcomeMsg.timestamp,
                    wamid: null,
                },
            });
            log.info({ phoneNumber }, '[worker] welcome message sent for new session');
        } catch (err) {
            log.error({ err }, '[worker] failed to send welcome message');
        }
        return { success: true };
    }

    let useStructuredSearch = false;

    try {
        const filters = await deps.extractSearchFilters(messageText);
        if (
            filters.intent === 'search' &&
            (filters.city || filters.state) &&
            filters.maxPrice
        ) {
            const result = await deps.searchProperties({
                city: filters.city ?? undefined,
                state: filters.state ?? undefined,
                maxPrice: filters.maxPrice,
            } as PropertySearchInput);

            const searchAnswer = buildSearchResponse({
                total: result.meta.total,
                city: filters.city,
                state: filters.state,
                maxPrice: filters.maxPrice,
                appBaseUrl: deps.appBaseUrl,
            });

            await deps.sendMessage(phoneNumber, searchAnswer);
            const searchMsg = await deps.prisma.message.create({
                data: {
                    sessionId: chatSession.id,
                    senderType: 'BOT',
                    content: searchAnswer,
                },
            });

            await deps.emitEvent?.('new_message', {
                tenantId: user.id,
                sessionId: chatSession.id,
                message: {
                    id: searchMsg.id,
                    sessionId: chatSession.id,
                    senderType: 'BOT',
                    content: searchAnswer,
                    status: 'sent',
                    timestamp: searchMsg.timestamp,
                    wamid: null,
                },
            });

            log.info(
                { phoneNumber, total: result.meta.total, city: filters.city, state: filters.state, maxPrice: filters.maxPrice },
                '[worker] structured search response sent; skipping RAG',
            );

            useStructuredSearch = true;
        }
    } catch (extractionErr) {
        log.warn({ err: extractionErr }, '[worker] search extraction failed; falling back to RAG');
    }

    if (useStructuredSearch) {
        return { success: true };
    }

    let answer: string;
    let handoff: boolean;
    let ragError = false;

    try {
        const result = await deps.generateAnswer({
            sessionId: chatSession.id,
            userMessage: messageText,
        });
        answer = result.answer;
        handoff = result.handoff;
    } catch (err) {
        log.error({ err }, '[worker] RAG chain failure');
        answer = RAG_ERROR_FALLBACK;
        handoff = true;
        ragError = true;
    }

    let outboundWamid: string | null = null;
    try {
        const response = await deps.sendMessage(phoneNumber, answer);
        outboundWamid = response.messages?.[0]?.id ?? null;
    } catch (sendError) {
        log.error({ err: sendError }, '[worker] failed to send WhatsApp message');
    }

    const ragMsg = await deps.prisma.message.create({
        data: {
            wamid: outboundWamid,
            sessionId: chatSession.id,
            senderType: 'BOT',
            content: answer,
        },
    });

    await deps.emitEvent?.('new_message', {
        tenantId: user.id,
        sessionId: chatSession.id,
        message: {
            id: ragMsg.id,
            sessionId: chatSession.id,
            senderType: 'BOT',
            content: answer,
            status: 'sent',
            timestamp: ragMsg.timestamp,
            wamid: outboundWamid,
        },
    });

    if (handoff) {
        await deps.prisma.chatSession.update({
            where: { id: chatSession.id },
            data: { status: 'WAITING_HUMAN' },
        });

        await deps.emitEvent?.('session_updated', {
            tenantId: user.id,
            sessionId: chatSession.id,
            status: 'WAITING_HUMAN',
        });
    }

    if (!ragError) {
        const schedule = deps.scheduleMicrotask ?? queueMicrotask;
        const limiter = deps.leadExtractionLimiter ?? defaultLeadExtractionLimiter;
        const sessionIdForExtraction = chatSession.id;
        schedule(() => {
            limiter
                .run(() =>
                    deps.extractInsights({
                        sessionId: sessionIdForExtraction,
                        userMessage: messageText,
                    }),
                )
                .catch((err) => {
                    log.error(
                        { err, sessionId: sessionIdForExtraction },
                        '[worker] lead extraction failed',
                    );
                });
        });
    }

    log.info({ phoneNumber, sessionId: chatSession.id, handoff, ragError }, '[worker] message processed');
    return { success: true, handoff, ragError };
}

if (!process.env.REDIS_URL) {
    throw new Error('[Worker] REDIS_URL não definida no ambiente. O Worker não pode iniciar sem uma conexão Redis configurada.');
}
const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: () => null,
});

connection.on('error', (err) => {
    logger.error({ err }, '[worker] redis connection failed');
    process.exit(1);
});

const socketEmitter = new Emitter(connection);

export const whatsappWorker = new Worker<WhatsAppWebhookPayload>(
    'whatsapp-messages',
    async (job: Job<WhatsAppWebhookPayload>) => {
        const wamid = (job.data as any)?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
        const jobLog = logger.child({ jobId: job.id, wamid });
        jobLog.info('[worker] processing job');
        try {
            return await handleWhatsappMessage(job.data, {
                prisma,
                sendMessage: defaultSendMessage,
                generateAnswer: defaultGenerateAnswer,
                extractInsights: defaultExtractInsights,
                extractSearchFilters: defaultExtractSearchFilters,
                searchProperties: propertyService.searchProperties.bind(propertyService),
                appBaseUrl: process.env.APP_BASE_URL || 'https://app.i-moveis.com',
                log: jobLog,
                checkRateLimit: (phoneNumber) =>
                    checkPhoneRateLimit(connection, phoneNumber, {
                        limit: PHONE_RATE_LIMIT,
                        windowSeconds: PHONE_RATE_WINDOW_SECONDS,
                    }),
                emitEvent: async (event: string, data: any) => {
                    socketEmitter.emit(event, data);
                },
            });
        } catch (dbError: any) {
            if (dbError?.code === 'P2002' && dbError?.meta?.target?.includes('wamid')) {
                jobLog.info('[worker] duplicate wamid unique constraint; skipping');
                return { success: true, reason: 'duplicate_wamid_db' };
            }
            jobLog.error({ err: dbError }, '[worker] job failed');
            throw dbError;
        }
    },
    { connection, lockDuration: 60000 }
);

whatsappWorker.on('completed', (job: Job) => {
    logger.info({ jobId: job.id }, '[worker] job completed');
});

whatsappWorker.on('failed', (job: Job | undefined, err: Error) => {
    const attemptsMade = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 1;
    const exhausted = attemptsMade >= maxAttempts;
    const level = exhausted ? 'dead-letter' : 'retry';
    logger.error(
        { jobId: job?.id, attemptsMade, maxAttempts, level, err },
        `[worker] job failed (${level})`,
    );
});
