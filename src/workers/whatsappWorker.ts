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
import { whatsappRegistration } from '../services/whatsappRegistrationService';

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

type PrismaWorkerClient = Pick<PrismaClient, 'user' | 'chatSession' | 'message' | 'property'>;

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
    // Bot só morre quando a sessão é RESOLVED ou expirou (7 dias).
    // WAITING_HUMAN mantém o bot ativo — o humano complementa, não substitui.
    const isNewOrResetSession = !previousSession || previousSession.status === 'RESOLVED' || expired;

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

    // Cadastro via WhatsApp: sempre que detectar email na mensagem,
    // tenta registrar/vincular. O register() já trata "já existe" e
    // "não existe" corretamente.
    const extractedEmail = whatsappRegistration.isEmail(messageText);
    if (extractedEmail) {
        try {
            const regResult = await whatsappRegistration.register({
                phoneNumber,
                name: contactName,
                email: extractedEmail,
            });
            await deps.sendMessage(phoneNumber, regResult.message);
            await deps.prisma.message.create({
                data: {
                    sessionId: chatSession.id,
                    senderType: 'BOT',
                    content: regResult.message,
                },
            });
            if (regResult.success) {
                log.info({ phoneNumber, email: regResult.email }, '[worker] whatsapp registration done');
            }
        } catch (err) {
            log.error({ err }, '[worker] whatsapp registration failed');
        }
        return { success: true };
    }

    // Fallback: se usuario falar "nao chegou" / "nao recebi" o email,
    // e tiver um link de reset em cache, envia o link direto no WhatsApp.
    const noEmailPhrases = /\b(?:n[aã]o\s+(?:chegou|recebi|veio)|n[aã]o\s+encontrei|cad[eê]\s+o\s+email|cad[eê]\s+o\s+link|reenviar|re-enviar)\b/i;
    if (noEmailPhrases.test(messageText)) {
        const cachedLink = whatsappRegistration.getResetLink(phoneNumber);
        if (cachedLink) {
            await deps.sendMessage(
                phoneNumber,
                "Sem problemas! \u{1F511} Aqui esta o link direto para criar sua senha:\n\n" + cachedLink + "\n\nQualquer duvida, e so chamar!"
            );
            await deps.prisma.message.create({
                data: {
                    sessionId: chatSession.id,
                    senderType: 'BOT',
                    content: cachedLink,
                },
            });
            log.info({ phoneNumber }, '[worker] reset link resent via WhatsApp');
            return { success: true };
        }
    }

    if (isNewOrResetSession && GREETING_REGEX.test(messageText.trim())) {
        try {
            const welcomeText = !user.firebaseUid
                ? WELCOME_MESSAGE + "\n\n\u{1F4E7} Pra finalizar seu cadastro rapidinho, qual seu melhor e-mail?"
                : WELCOME_MESSAGE;
            await deps.sendMessage(phoneNumber, welcomeText);
            const welcomeMsg = await deps.prisma.message.create({
                data: {
                    sessionId: chatSession.id,
                    senderType: 'BOT',
                    content: welcomeText,
                },
            });

            await deps.emitEvent?.('new_message', {
                tenantId: user.id,
                sessionId: chatSession.id,
                message: {
                    id: welcomeMsg.id,
                    sessionId: chatSession.id,
                    senderType: 'BOT',
                    content: welcomeText,
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

    // Roda extração de busca estruturada E RAG em paralelo.
    // Se a extração achar city+state+maxPrice, usa busca estruturada e
    // descarta o RAG. Se falhar, o RAG já está pronto (embedding+retrieval
    // já concluídos), economizando 1-3s de latência.
    const ragPromise = deps.generateAnswer({
        sessionId: chatSession.id,
        userMessage: messageText,
    });

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

            // Vincula o primeiro imóvel encontrado à sessão
            const topProperty = result.data?.[0];
            if (topProperty) {
                await deps.prisma.chatSession.update({
                    where: { id: chatSession.id },
                    data: { propertyId: topProperty.id },
                });
            }

            await deps.emitEvent?.('new_message', {
                tenantId: user.id,
                sessionId: chatSession.id,
                propertyId: topProperty?.id ?? null,
                landlordId: topProperty?.landlordId ?? null,
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

            return { success: true };
        }
    } catch (extractionErr) {
        log.warn({ err: extractionErr }, '[worker] search extraction failed; falling back to RAG');
    }

    // RAG já estava rodando em paralelo — espera o resultado
    let answer: string;
    let handoff: boolean;
    let ragError = false;

    try {
        const result = await ragPromise;
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
