"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InsightsSchema = exports.INTENT_VALUES = void 0;
exports.buildExtractionMessages = buildExtractionMessages;
exports.serializeInsightValue = serializeInsightValue;
exports.extractInsights = extractInsights;
const messages_1 = require("@langchain/core/messages");
const zod_1 = require("zod");
const db_1 = __importDefault(require("../config/db"));
const aiProvider_1 = require("../config/aiProvider");
exports.INTENT_VALUES = [
    "search",
    "schedule_visit",
    "contract_question",
    "human_handoff",
    "other",
];
exports.InsightsSchema = zod_1.z.object({
    budget: zod_1.z.string().optional().nullable(),
    neighborhood: zod_1.z.string().optional().nullable(),
    bedrooms: zod_1.z.number().int().optional().nullable(),
    pets_allowed: zod_1.z.boolean().optional().nullable(),
    intent: zod_1.z.enum(exports.INTENT_VALUES),
});
const SYSTEM_PROMPT = [
    "Você é um extrator estruturado de informações do I-Moveis (aluguel de imóveis no Brasil).",
    "",
    "Sua função é ler a mensagem do inquilino e extrair, quando presentes, as seguintes informações:",
    "- budget: orçamento mensal mencionado (ex: 'R$ 2.000', 'até 2500'). Mantenha o texto como apareceu.",
    "- neighborhood: bairro ou região desejada (ex: 'Pinheiros', 'zona sul').",
    "- bedrooms: número de quartos desejado (inteiro).",
    "- pets_allowed: true se o usuário mencionou que precisa aceitar pets; false se mencionou que NÃO tem pets; null caso não mencione.",
    "- intent: uma das opções abaixo, escolhida pela intenção predominante da mensagem:",
    "  * \"search\" — está procurando imóveis para alugar.",
    "  * \"schedule_visit\" — quer agendar uma visita.",
    "  * \"contract_question\" — dúvida sobre contrato, documentação ou políticas.",
    "  * \"human_handoff\" — pede para falar com um humano, reclama, ou a mensagem envolve litígio/exceção.",
    "  * \"other\" — qualquer outra coisa (saudação, agradecimento, etc).",
    "",
    "Regras importantes:",
    "- NÃO invente dados. Se uma informação não está na mensagem, retorne null ou omita o campo (exceto intent, que é sempre obrigatório).",
    "- intent sempre deve ser uma das cinco strings acima.",
    "- Responda APENAS no formato estruturado solicitado.",
].join("\n");
function buildExtractionMessages(userMessage) {
    return [new messages_1.SystemMessage(SYSTEM_PROMPT), new messages_1.HumanMessage(userMessage)];
}
function serializeInsightValue(value) {
    if (typeof value === "string")
        return value;
    if (typeof value === "number")
        return String(value);
    if (typeof value === "boolean")
        return value ? "true" : "false";
    return String(value);
}
const INSIGHT_KEYS = [
    "budget",
    "neighborhood",
    "bedrooms",
    "pets_allowed",
    "intent",
];
let defaultDepsCache = null;
function getDefaultDeps() {
    if (defaultDepsCache)
        return defaultDepsCache;
    defaultDepsCache = {
        prisma: db_1.default,
        llm: (0, aiProvider_1.getStructuredChatModel)(exports.InsightsSchema, "extract_lead_insights"),
    };
    return defaultDepsCache;
}
async function extractInsights(input, overrideDeps) {
    const { sessionId, userMessage } = input;
    const deps = overrideDeps ?? getDefaultDeps();
    const session = await deps.prisma.chatSession.findUnique({
        where: { id: sessionId },
        select: { id: true, tenantId: true, status: true },
    });
    if (!session) {
        throw new Error(`[leadExtraction] ChatSession ${sessionId} not found; cannot extract insights.`);
    }
    const messages = buildExtractionMessages(userMessage);
    const parsed = await deps.llm.extract(messages);
    const insights = exports.InsightsSchema.parse(parsed);
    let rentalProcess = await deps.prisma.rentalProcess.findFirst({
        where: {
            tenantId: session.tenantId,
            status: { not: "CLOSED" },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
    });
    if (!rentalProcess) {
        rentalProcess = await deps.prisma.rentalProcess.create({
            data: { tenantId: session.tenantId, status: "TRIAGE" },
            select: { id: true },
        });
    }
    const rentalProcessId = rentalProcess.id;
    const upsertedKeys = [];
    for (const key of INSIGHT_KEYS) {
        const value = insights[key];
        if (value === undefined || value === null)
            continue;
        const insightValue = serializeInsightValue(value);
        const existing = await deps.prisma.aiExtractedInsight.findFirst({
            where: { rentalProcessId, insightKey: key },
            select: { id: true, insightValue: true },
        });
        if (existing) {
            if (existing.insightValue !== insightValue) {
                await deps.prisma.aiExtractedInsight.update({
                    where: { id: existing.id },
                    data: { insightValue },
                });
            }
        }
        else {
            await deps.prisma.aiExtractedInsight.create({
                data: { rentalProcessId, insightKey: key, insightValue },
            });
        }
        upsertedKeys.push(key);
    }
    let handoff = false;
    if (insights.intent === "human_handoff" && session.status !== "WAITING_HUMAN") {
        await deps.prisma.chatSession.update({
            where: { id: sessionId },
            data: { status: "WAITING_HUMAN" },
        });
        handoff = true;
    }
    return {
        insights,
        rentalProcessId,
        upsertedKeys,
        handoff,
    };
}
