import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAxiosPost = vi.hoisted(() => {
    process.env.TOKEN_ACCES_WHATSAPP = 'test-access-token';
    process.env.PHONE_NUMBER_ID = 'test-phone-id';
    process.env.REDIS_URL = 'redis://localhost:6379';
    return vi.fn();
});

vi.mock('axios', () => ({
    default: {
        post: mockAxiosPost,
    },
}));

vi.mock('ioredis', () => {
    class FakeIORedis {
        on() { return this; }
        connect() { return Promise.resolve(); }
        disconnect() { /* noop */ }
        quit() { return Promise.resolve(); }
    }
    return { default: FakeIORedis };
});

vi.mock('../src/config/db', () => ({
    default: {
        user: { upsert: vi.fn() },
        chatSession: {
            findFirst: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
        },
        message: {
            create: vi.fn(),
            findUnique: vi.fn(),
        },
    },
}));

import { sendMessage } from '../src/services/whatsappService';
import {
    createConcurrencyLimiter,
    handleWhatsappMessage,
    isSessionExpired,
    RAG_ERROR_FALLBACK,
    SESSION_TTL_MS,
    type WhatsappHandlerDeps,
} from '../src/workers/whatsappWorker';
import type { WhatsAppWebhookPayload } from '../src/types/whatsapp';

beforeEach(() => {
    vi.clearAllMocks();
});

type InboundOpts = {
    phoneNumber?: string;
    messageText?: string;
    wamid?: string;
    contactName?: string;
};

function makeInboundPayload(opts: InboundOpts = {}): WhatsAppWebhookPayload {
    const phoneNumber = opts.phoneNumber ?? '5511999998888';
    const wamid = opts.wamid ?? 'wamid.INBOUND123';
    return {
        object: 'whatsapp_business_account',
        entry: [
            {
                id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
                changes: [
                    {
                        value: {
                            messaging_product: 'whatsapp',
                            contacts: [
                                {
                                    wa_id: phoneNumber,
                                    profile: { name: opts.contactName ?? 'Maria' },
                                },
                            ],
                            messages: [
                                {
                                    from: phoneNumber,
                                    id: wamid,
                                    timestamp: '1700000000',
                                    type: 'text',
                                    text: { body: opts.messageText ?? 'Olá, quero alugar' },
                                },
                            ],
                        },
                        field: 'messages',
                    },
                ],
            },
        ],
    } as WhatsAppWebhookPayload;
}

function makeDeps(overrides: Partial<WhatsappHandlerDeps> = {}): WhatsappHandlerDeps & {
    generateAnswerMock: ReturnType<typeof vi.fn>;
    sendMessageMock: ReturnType<typeof vi.fn>;
    extractInsightsMock: ReturnType<typeof vi.fn>;
    scheduledMicrotasks: Array<() => void>;
    runScheduledMicrotasks: () => Promise<void>;
    prismaMocks: {
        userUpsert: ReturnType<typeof vi.fn>;
        sessionFindFirst: ReturnType<typeof vi.fn>;
        sessionCreate: ReturnType<typeof vi.fn>;
        sessionUpdate: ReturnType<typeof vi.fn>;
        messageCreate: ReturnType<typeof vi.fn>;
        messageFindUnique: ReturnType<typeof vi.fn>;
    };
} {
    const userUpsert = vi.fn().mockResolvedValue({ id: 'user-1', phoneNumber: '5511999998888', name: 'Maria' });
    const sessionFindFirst = vi.fn().mockResolvedValue(null);
    const sessionCreate = vi.fn().mockResolvedValue({
        id: 'session-1',
        tenantId: 'user-1',
        status: 'ACTIVE_BOT',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    const sessionUpdate = vi.fn().mockResolvedValue({
        id: 'session-1',
        status: 'WAITING_HUMAN',
    });
    const messageCreate = vi.fn().mockResolvedValue({ id: 'msg-1' });
    const messageFindUnique = vi.fn().mockResolvedValue(null);

    const prismaMock = {
        user: { upsert: userUpsert },
        chatSession: {
            findFirst: sessionFindFirst,
            create: sessionCreate,
            update: sessionUpdate,
        },
        message: {
            create: messageCreate,
            findUnique: messageFindUnique,
        },
    } as unknown as WhatsappHandlerDeps['prisma'];

    const sendMessageMock = vi.fn().mockResolvedValue({
        messages: [{ id: 'wamid.OUTBOUND456' }],
    });

    const generateAnswerMock = vi.fn().mockResolvedValue({
        answer: 'Resposta fundamentada em português.',
        handoff: false,
        topScore: 0.85,
        usedChunkIds: ['chunk-1'],
    });

    const extractInsightsMock = vi.fn().mockResolvedValue({
        insights: { intent: 'other' },
        rentalProcessId: 'rp-1',
        upsertedKeys: ['intent'],
        handoff: false,
    });

    const scheduledMicrotasks: Array<() => void> = [];
    const scheduleMicrotask = (task: () => void) => {
        scheduledMicrotasks.push(task);
    };
    const runScheduledMicrotasks = async () => {
        const tasks = scheduledMicrotasks.splice(0, scheduledMicrotasks.length);
        for (const t of tasks) t();
        // let any promises inside the tasks settle
        await new Promise((r) => setImmediate(r));
    };

    return {
        prisma: prismaMock,
        sendMessage: sendMessageMock,
        generateAnswer: generateAnswerMock,
        extractInsights: extractInsightsMock,
        scheduleMicrotask,
        ...overrides,
        generateAnswerMock,
        sendMessageMock,
        extractInsightsMock,
        scheduledMicrotasks,
        runScheduledMicrotasks,
        prismaMocks: {
            userUpsert,
            sessionFindFirst,
            sessionCreate,
            sessionUpdate,
            messageCreate,
            messageFindUnique,
        },
    };
}

describe('whatsappService.sendMessage', () => {
    it('sends a message via Meta API and returns response data', async () => {
        const mockResponse = {
            data: {
                messaging_product: 'whatsapp',
                contacts: [{ input: '5511999998888', wa_id: '5511999998888' }],
                messages: [{ id: 'wamid-meta-123' }],
            },
        };
        mockAxiosPost.mockResolvedValue(mockResponse);

        const result = await sendMessage('5511999998888', 'Hello!');

        expect(mockAxiosPost).toHaveBeenCalledWith(
            'https://graph.facebook.com/v20.0/test-phone-id/messages',
            {
                messaging_product: 'whatsapp',
                to: '5511999998888',
                type: 'text',
                text: { body: 'Hello!' },
            },
            {
                headers: {
                    Authorization: 'Bearer test-access-token',
                    'Content-Type': 'application/json',
                },
            },
        );
        expect(result).toEqual(mockResponse.data);
    });

    it('propagates Meta API restriction (130497) errors', async () => {
        const metaError: any = new Error('Request failed with status code 403');
        metaError.response = {
            data: {
                error: {
                    message: '(130497) Restrictions on the phone number do not allow sending messages.',
                    code: 130497,
                    error_subcode: 2615,
                },
            },
        };
        mockAxiosPost.mockRejectedValue(metaError);

        await expect(sendMessage('5511999998888', 'Hello!')).rejects.toThrow();
        expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    });

    it('propagates other API errors', async () => {
        const genericError: any = new Error('Request failed with status code 401');
        genericError.response = {
            data: { error: { message: 'Invalid access token', code: 190 } },
        };
        mockAxiosPost.mockRejectedValue(genericError);

        await expect(sendMessage('5511999998888', 'Hello!')).rejects.toThrow();
    });

    it('propagates network errors', async () => {
        const networkError = new Error('Network Error');
        mockAxiosPost.mockRejectedValue(networkError);

        await expect(sendMessage('5511999998888', 'Hello!')).rejects.toThrow('Network Error');
    });
});

describe('handleWhatsappMessage - empty / malformed payloads', () => {
    it('returns early when there are no changes', async () => {
        const deps = makeDeps();
        const result = await handleWhatsappMessage(
            { object: 'x', entry: [] } as unknown as WhatsAppWebhookPayload,
            deps,
        );
        expect(result).toEqual({ success: true, reason: 'ignored_empty_changes' });
        expect(deps.sendMessageMock).not.toHaveBeenCalled();
        expect(deps.generateAnswerMock).not.toHaveBeenCalled();
    });

    it('returns early when there is no message or contact', async () => {
        const deps = makeDeps();
        const payload = {
            object: 'whatsapp_business_account',
            entry: [{ id: 'x', changes: [{ value: { messaging_product: 'whatsapp' }, field: 'messages' }] }],
        } as unknown as WhatsAppWebhookPayload;
        const result = await handleWhatsappMessage(payload, deps);
        expect(result).toEqual({ success: true, reason: 'ignored_not_message' });
    });

    it('returns early on duplicate inbound wamid', async () => {
        const deps = makeDeps();
        deps.prismaMocks.messageFindUnique.mockResolvedValueOnce({ id: 'existing', wamid: 'wamid.INBOUND123' });

        const result = await handleWhatsappMessage(makeInboundPayload(), deps);
        expect(result).toEqual({ success: true, reason: 'duplicate_wamid' });
        expect(deps.prismaMocks.userUpsert).not.toHaveBeenCalled();
        expect(deps.generateAnswerMock).not.toHaveBeenCalled();
    });

    it('sends a default reply and returns early for non-text message types', async () => {
        const deps = makeDeps();
        const payload: WhatsAppWebhookPayload = {
            object: 'whatsapp_business_account',
            entry: [
                {
                    id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
                    changes: [
                        {
                            value: {
                                messaging_product: 'whatsapp',
                                contacts: [{ wa_id: '5511999998888', profile: { name: 'Maria' } }],
                                messages: [
                                    {
                                        from: '5511999998888',
                                        id: 'wamid.NONTEXT1',
                                        timestamp: '1700000000',
                                        type: 'image',
                                    },
                                ],
                            },
                            field: 'messages',
                        },
                    ],
                },
            ],
        } as unknown as WhatsAppWebhookPayload;

        const result = await handleWhatsappMessage(payload, deps);

        expect(result).toEqual({ success: true, reason: 'non_text_message' });
        expect(deps.sendMessageMock).toHaveBeenCalledTimes(1);
        expect(deps.sendMessageMock).toHaveBeenCalledWith(
            '5511999998888',
            expect.stringContaining('só consigo entender mensagens de texto'),
        );
        expect(deps.prismaMocks.userUpsert).not.toHaveBeenCalled();
        expect(deps.generateAnswerMock).not.toHaveBeenCalled();
    });
});

describe('handleWhatsappMessage - happy path (grounded answer)', () => {
    it('upserts user, reuses ACTIVE_BOT session, persists inbound + outbound, sends answer, keeps session ACTIVE', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-1',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
        });

        const result = await handleWhatsappMessage(makeInboundPayload(), deps);

        expect(deps.prismaMocks.userUpsert).toHaveBeenCalledWith({
            where: { phoneNumber: '5511999998888' },
            update: { name: 'Maria' },
            create: { phoneNumber: '5511999998888', name: 'Maria', role: 'TENANT' },
        });
        expect(deps.prismaMocks.sessionCreate).not.toHaveBeenCalled();

        const createCalls = deps.prismaMocks.messageCreate.mock.calls.map((c) => c[0].data);
        expect(createCalls).toHaveLength(2);
        expect(createCalls[0]).toMatchObject({
            wamid: 'wamid.INBOUND123',
            sessionId: 'session-1',
            senderType: 'TENANT',
            content: 'Olá, quero alugar',
        });
        expect(createCalls[1]).toMatchObject({
            wamid: 'wamid.OUTBOUND456',
            sessionId: 'session-1',
            senderType: 'BOT',
            content: 'Resposta fundamentada em português.',
        });

        expect(deps.generateAnswerMock).toHaveBeenCalledWith({
            sessionId: 'session-1',
            userMessage: 'Olá, quero alugar',
        });
        expect(deps.sendMessageMock).toHaveBeenCalledWith(
            '5511999998888',
            'Resposta fundamentada em português.',
        );
        expect(deps.prismaMocks.sessionUpdate).not.toHaveBeenCalled();
        expect(result).toEqual({ success: true, handoff: false, ragError: false });
    });

    it('creates a new ACTIVE_BOT session when none exists', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce(null);
        deps.prismaMocks.sessionCreate.mockResolvedValueOnce({
            id: 'session-new',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
        });

        await handleWhatsappMessage(makeInboundPayload(), deps);

        expect(deps.prismaMocks.sessionCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({ tenantId: 'user-1', status: 'ACTIVE_BOT' }),
        });
        expect(deps.generateAnswerMock).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 'session-new' }),
        );
    });
});

describe('createConcurrencyLimiter', () => {
    it('runs tasks immediately while under the concurrency cap', async () => {
        const limiter = createConcurrencyLimiter(3);
        const results = await Promise.all([
            limiter.run(async () => 1),
            limiter.run(async () => 2),
            limiter.run(async () => 3),
        ]);
        expect(results).toEqual([1, 2, 3]);
    });

    it('holds additional tasks until a slot frees up', async () => {
        const limiter = createConcurrencyLimiter(2);
        const timeline: string[] = [];
        let releaseA: () => void = () => { };
        let releaseB: () => void = () => { };

        const a = limiter.run(async () => {
            timeline.push('A:start');
            await new Promise<void>((r) => { releaseA = r; });
            timeline.push('A:end');
        });
        const b = limiter.run(async () => {
            timeline.push('B:start');
            await new Promise<void>((r) => { releaseB = r; });
            timeline.push('B:end');
        });
        const c = limiter.run(async () => {
            timeline.push('C:start');
        });

        // let scheduling settle
        await new Promise((r) => setImmediate(r));
        expect(timeline).toEqual(['A:start', 'B:start']); // C is queued

        releaseA();
        await a;
        await c;
        expect(timeline).toContain('A:end');
        expect(timeline).toContain('C:start');

        releaseB();
        await b;
    });

    it('releases a slot even when the task throws', async () => {
        const limiter = createConcurrencyLimiter(1);
        await expect(
            limiter.run(async () => { throw new Error('boom'); }),
        ).rejects.toThrow('boom');

        // Next call should proceed without deadlock.
        await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
    });
});

describe('handleWhatsappMessage - lead extraction hook', () => {
    it('schedules extractInsights after the outbound reply on the happy path', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-1',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
        });

        await handleWhatsappMessage(makeInboundPayload(), deps);

        // Scheduled but not yet invoked — extraction runs in a microtask
        expect(deps.extractInsightsMock).not.toHaveBeenCalled();
        expect(deps.scheduledMicrotasks).toHaveLength(1);

        await deps.runScheduledMicrotasks();
        expect(deps.extractInsightsMock).toHaveBeenCalledWith({
            sessionId: 'session-1',
            userMessage: 'Olá, quero alugar',
        });
    });

    it('does not let extractInsights failures throw out of the handler', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-1',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
        });
        deps.extractInsightsMock.mockRejectedValueOnce(new Error('LLM structured output blew up'));

        const result = await handleWhatsappMessage(makeInboundPayload(), deps);
        expect(result).toEqual({ success: true, handoff: false, ragError: false });

        await deps.runScheduledMicrotasks();
        expect(deps.extractInsightsMock).toHaveBeenCalledTimes(1);
    });
});

describe('handleWhatsappMessage - handoff path', () => {
    it('persists outbound fallback, sends it, and flips session to WAITING_HUMAN when handoff=true', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-1',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
        });
        deps.generateAnswerMock.mockResolvedValueOnce({
            answer: 'Vou encaminhar para um atendente humano.',
            handoff: true,
            topScore: 0.3,
            usedChunkIds: [],
        });

        const result = await handleWhatsappMessage(makeInboundPayload(), deps);

        expect(deps.sendMessageMock).toHaveBeenCalledWith(
            '5511999998888',
            'Vou encaminhar para um atendente humano.',
        );
        const createCalls = deps.prismaMocks.messageCreate.mock.calls.map((c) => c[0].data);
        expect(createCalls[1]).toMatchObject({
            senderType: 'BOT',
            content: 'Vou encaminhar para um atendente humano.',
        });
        expect(deps.prismaMocks.sessionUpdate).toHaveBeenCalledWith({
            where: { id: 'session-1' },
            data: { status: 'WAITING_HUMAN' },
        });
        expect(result).toEqual({ success: true, handoff: true, ragError: false });
    });
});

describe('isSessionExpired', () => {
    it('returns false for a null session', () => {
        expect(isSessionExpired(null)).toBe(false);
        expect(isSessionExpired(undefined)).toBe(false);
    });

    it('returns false when the session has no expiresAt set (legacy rows)', () => {
        expect(isSessionExpired({ expiresAt: null })).toBe(false);
        expect(isSessionExpired({})).toBe(false);
    });

    it('returns false for a session whose expiresAt is in the future', () => {
        const future = new Date(Date.now() + 60_000);
        expect(isSessionExpired({ expiresAt: future })).toBe(false);
    });

    it('returns true once expiresAt has passed', () => {
        const past = new Date(Date.now() - 60_000);
        expect(isSessionExpired({ expiresAt: past })).toBe(true);
    });
});

describe('handleWhatsappMessage - session TTL', () => {
    it('reuses an ACTIVE_BOT session that has not expired', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-live',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
        });

        await handleWhatsappMessage(makeInboundPayload(), deps);

        expect(deps.prismaMocks.sessionCreate).not.toHaveBeenCalled();
        expect(deps.generateAnswerMock).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 'session-live' }),
        );
    });

    it('creates a fresh ACTIVE_BOT session when the existing one has expired', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-stale',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
            expiresAt: new Date(Date.now() - 60_000),
        });
        deps.prismaMocks.sessionCreate.mockResolvedValueOnce({
            id: 'session-fresh',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        });

        await handleWhatsappMessage(makeInboundPayload(), deps);

        expect(deps.prismaMocks.sessionCreate).toHaveBeenCalledTimes(1);
        const createArg = deps.prismaMocks.sessionCreate.mock.calls[0][0].data;
        expect(createArg.tenantId).toBe('user-1');
        expect(createArg.status).toBe('ACTIVE_BOT');
        expect(createArg.expiresAt).toBeInstanceOf(Date);

        // expiresAt should be ~SESSION_TTL_MS in the future (allow 5s jitter)
        const delta = createArg.expiresAt.getTime() - Date.now();
        expect(delta).toBeGreaterThan(SESSION_TTL_MS - 5_000);
        expect(delta).toBeLessThanOrEqual(SESSION_TTL_MS);

        expect(deps.generateAnswerMock).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 'session-fresh' }),
        );
    });
});

describe('handleWhatsappMessage - inactive session creates new ACTIVE_BOT session', () => {
    it('reuses WAITING_HUMAN session (bot stays active, human complements)', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-wh',
            tenantId: 'user-1',
            status: 'WAITING_HUMAN',
            startedAt: new Date(),
        });

        const result = await handleWhatsappMessage(makeInboundPayload(), deps);

        expect(deps.prismaMocks.sessionCreate).not.toHaveBeenCalled();
        expect(deps.generateAnswerMock).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 'session-wh' }),
        );
        expect(deps.sendMessageMock).toHaveBeenCalled();
        expect(result).toEqual({ success: true, handoff: false, ragError: false });
    });

    it('creates a new ACTIVE_BOT session when existing session is RESOLVED', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-r',
            tenantId: 'user-1',
            status: 'RESOLVED',
            startedAt: new Date(),
        });
        deps.prismaMocks.sessionCreate.mockResolvedValueOnce({
            id: 'session-new',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
        });

        const result = await handleWhatsappMessage(makeInboundPayload(), deps);

        expect(deps.prismaMocks.sessionCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({ tenantId: 'user-1', status: 'ACTIVE_BOT' }),
        });
        expect(deps.generateAnswerMock).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 'session-new' }),
        );
        expect(deps.sendMessageMock).toHaveBeenCalled();
        expect(result).toEqual({ success: true, handoff: false, ragError: false });
    });
});

describe('handleWhatsappMessage - RAG errors', () => {
    it('catches RAG chain errors, sends a Portuguese apology, and flips session to WAITING_HUMAN', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-1',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
        });
        deps.generateAnswerMock.mockRejectedValueOnce(new Error('LLM offline'));

        const result = await handleWhatsappMessage(makeInboundPayload(), deps);

        expect(deps.sendMessageMock).toHaveBeenCalledWith(
            '5511999998888',
            RAG_ERROR_FALLBACK,
        );
        const createCalls = deps.prismaMocks.messageCreate.mock.calls.map((c) => c[0].data);
        expect(createCalls[1]).toMatchObject({
            senderType: 'BOT',
            content: RAG_ERROR_FALLBACK,
        });
        expect(deps.prismaMocks.sessionUpdate).toHaveBeenCalledWith({
            where: { id: 'session-1' },
            data: { status: 'WAITING_HUMAN' },
        });
        expect(result.ragError).toBe(true);
        expect(result.handoff).toBe(true);
    });

    it('does NOT schedule lead extraction when RAG chain errored', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-1',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
        });
        deps.generateAnswerMock.mockRejectedValueOnce(new Error('LLM offline'));

        await handleWhatsappMessage(makeInboundPayload(), deps);
        expect(deps.scheduledMicrotasks).toHaveLength(0);
        expect(deps.extractInsightsMock).not.toHaveBeenCalled();
    });

    it('still persists outbound and flips session even when sendMessage itself throws', async () => {
        const deps = makeDeps();
        deps.prismaMocks.sessionFindFirst.mockResolvedValueOnce({
            id: 'session-1',
            tenantId: 'user-1',
            status: 'ACTIVE_BOT',
            startedAt: new Date(),
        });
        deps.generateAnswerMock.mockResolvedValueOnce({
            answer: 'Olá!',
            handoff: true,
            topScore: 0.2,
            usedChunkIds: [],
        });
        deps.sendMessageMock.mockRejectedValueOnce(new Error('network'));

        const result = await handleWhatsappMessage(makeInboundPayload(), deps);

        const createCalls = deps.prismaMocks.messageCreate.mock.calls.map((c) => c[0].data);
        expect(createCalls[1]).toMatchObject({
            wamid: null,
            senderType: 'BOT',
            content: 'Olá!',
        });
        expect(deps.prismaMocks.sessionUpdate).toHaveBeenCalled();
        expect(result.handoff).toBe(true);
    });
});
