"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchFiltersSchema = exports.SEARCH_INTENT_VALUES = void 0;
exports.buildSearchExtractionMessages = buildSearchExtractionMessages;
exports.extractSearchFilters = extractSearchFilters;
exports.buildSearchResponse = buildSearchResponse;
const messages_1 = require("@langchain/core/messages");
const zod_1 = require("zod");
const aiProvider_1 = require("../config/aiProvider");
exports.SEARCH_INTENT_VALUES = ["search", "other"];
const BR_STATES = new Set([
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
    "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
    "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);
const STATE_NAME_TO_ABBR = {
    "acre": "AC", "alagoas": "AL", "amapa": "AP", "amapá": "AP",
    "amazonas": "AM", "bahia": "BA", "ceara": "CE", "ceará": "CE",
    "distrito federal": "DF", "espirito santo": "ES", "espírito santo": "ES",
    "goias": "GO", "goiás": "GO", "maranhao": "MA", "maranhão": "MA",
    "mato grosso": "MT", "mato grosso do sul": "MS",
    "minas gerais": "MG", "para": "PA", "pará": "PA",
    "paraiba": "PB", "paraíba": "PB", "parana": "PR", "paraná": "PR",
    "pernambuco": "PE", "piaui": "PI", "piauí": "PI",
    "rio de janeiro": "RJ", "rio grande do norte": "RN",
    "rio grande do sul": "RS", "rondonia": "RO", "rondônia": "RO",
    "roraima": "RR", "santa catarina": "SC",
    "sao paulo": "SP", "são paulo": "SP",
    "sergipe": "SE", "tocantins": "TO",
};
function normalizeState(raw) {
    if (!raw || raw.trim() === "")
        return null;
    const cleaned = raw.trim().replace(/[^a-zA-ZÀ-ÿ\s]/g, "");
    const upper = cleaned.toUpperCase();
    if (BR_STATES.has(upper))
        return upper;
    const lower = cleaned.toLowerCase();
    if (STATE_NAME_TO_ABBR[lower])
        return STATE_NAME_TO_ABBR[lower];
    return null;
}
function cleanPrice(raw) {
    if (raw === null || raw === undefined || raw === "")
        return null;
    let str = String(raw).trim();
    str = str.replace(/[R$\s._-]/g, "").replace(",", ".");
    const num = Number(str);
    if (!Number.isFinite(num) || num <= 0)
        return null;
    return num;
}
function normalizeNullableString(raw) {
    if (!raw || raw.trim() === "")
        return null;
    const lower = raw.trim().toLowerCase();
    if (lower === "null" || lower === "undefined" || lower === "nenhuma" || lower === "nenhum")
        return null;
    return raw.trim();
}
exports.SearchFiltersSchema = zod_1.z.object({
    intent: zod_1.z.enum(exports.SEARCH_INTENT_VALUES),
    city: zod_1.z.string().nullable(),
    state: zod_1.z.string().nullable(),
    maxPrice: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).nullable(),
});
const SYSTEM_PROMPT = [
    "Você é um extrator de parâmetros de busca imobiliária do I-Móveis (aluguel de imóveis no Brasil).",
    "",
    "Sua função é ler a mensagem do inquilino e extrair, quando presentes, os seguintes filtros:",
    "- intent: \"search\" se o usuário está procurando imóveis com filtros de cidade/estado E orçamento máximo. \"other\" caso contrário (ex: perguntas gerais, saudações, pedido de visita, dúvida sobre contrato).",
    "- city: nome da cidade mencionada (ex: \"São Paulo\", \"Rio de Janeiro\", \"Belo Horizonte\"). null se não mencionada.",
    "- state: sigla de 2 letras do estado (ex: \"SP\", \"RJ\", \"MG\"). null se não mencionada.",
    "- maxPrice: valor máximo de aluguel em reais, apenas o número (ex: 1500 para \"R$ 1.500\" ou \"até 1500\"). null se não mencionado.",
    "",
    "Regras IMPORTANTES:",
    "- \"Centro\" sozinho NÃO é city — é um bairro. city deve ser o nome completo de uma cidade.",
    "- Se o usuário disser \"Rio de Janeiro\", extraia city=\"Rio de Janeiro\" e state=\"RJ\".",
    "- Se disser apenas a sigla do estado (ex: \"RJ\", \"SP\"), extraia city=null e state=\"RJ\" ou \"SP\".",
    "- Se o usuário disser \"São Paulo\", extraia city=\"São Paulo\" e state=\"SP\".",
    "- maxPrice deve ser o valor NUMÉRICO, sem símbolos ou texto (ex: \"R$ 2.500\" → maxPrice=2500).",
    "- Só retorne intent=\"search\" quando houver PELO MENOS uma cidade OU estado E um orçamento máximo.",
    "- Se não houver informação suficiente para uma busca estruturada, retorne intent=\"other\" com os demais campos como null.",
    "- NÃO invente dados. Se uma informação não está na mensagem, retorne null.",
    "- Responda APENAS no formato estruturado solicitado.",
].join("\n");
function buildSearchExtractionMessages(userMessage) {
    return [new messages_1.SystemMessage(SYSTEM_PROMPT), new messages_1.HumanMessage(userMessage)];
}
let defaultExtractorCache = null;
function getDefaultExtractor() {
    if (defaultExtractorCache)
        return defaultExtractorCache;
    defaultExtractorCache = (0, aiProvider_1.getStructuredChatModel)(exports.SearchFiltersSchema, "extract_search_filters");
    return defaultExtractorCache;
}
async function extractSearchFilters(userMessage) {
    const extractor = getDefaultExtractor();
    const messages = buildSearchExtractionMessages(userMessage);
    const raw = await extractor.extract(messages);
    const parsed = exports.SearchFiltersSchema.parse(raw);
    return {
        intent: parsed.intent,
        city: normalizeNullableString(parsed.city),
        state: normalizeState(parsed.state),
        maxPrice: cleanPrice(parsed.maxPrice),
    };
}
function buildSearchResponse(params) {
    const { total, city, state, maxPrice, appBaseUrl } = params;
    const location = city ? `${city}/${state}` : state;
    const searchParams = new URLSearchParams();
    if (state)
        searchParams.set("state", state);
    if (city)
        searchParams.set("city", city);
    searchParams.set("maxPrice", String(maxPrice));
    const deepLink = `${appBaseUrl}/api/deeplink?${searchParams.toString()}`;
    const formattedPrice = maxPrice.toLocaleString("pt-BR");
    if (total === 0) {
        return [
            `Infelizmente não encontrei imóveis em ${location} até R$ ${formattedPrice} no momento. \u{1F615}`,
            "",
            "Que tal ajustar o orçamento ou buscar em outra região?",
        ].join("\n");
    }
    return [
        `Encontrei ${total} imóveis em ${location} que cabem no seu orçamento de até R$ ${formattedPrice}. \u{1F3AF}`,
        "",
        "Veja as fotos, detalhes completos e filtre como quiser:",
        `\u{1F449} ${deepLink}`,
    ].join("\n");
}
