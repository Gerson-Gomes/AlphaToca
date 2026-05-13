"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpenRouterEmbedder = createOpenRouterEmbedder;
const openai_1 = __importDefault(require("openai"));
const rag_1 = require("./rag");
function requireEnv(name) {
    const value = process.env[name];
    if (!value || value.trim() === "") {
        throw new Error(`[openrouterEmbedder] Missing env: ${name}`);
    }
    return value;
}
let clientCache = null;
function getClient() {
    if (clientCache)
        return clientCache;
    clientCache = new openai_1.default({
        apiKey: requireEnv("OPENROUTER_API_KEY"),
        baseURL: "https://openrouter.ai/api/v1",
    });
    return clientCache;
}
// Usa o mesmo modelo Gemini via OpenRouter — embeddings compatíveis
// com o que já foi ingerido (1536 dims, L2 normalized).
const EMBED_MODEL = "google/gemini-embedding-001";
async function embedOne(text) {
    const client = getClient();
    const res = await client.embeddings.create({
        model: EMBED_MODEL,
        input: text,
        dimensions: rag_1.EMBEDDING_DIMS,
    });
    const vector = res.data?.[0]?.embedding;
    if (!vector || vector.length === 0) {
        throw new Error("[openrouterEmbedder] empty embedding");
    }
    return (0, rag_1.l2Normalize)(vector);
}
async function embedBatch(texts) {
    if (texts.length === 0)
        return [];
    const client = getClient();
    const res = await client.embeddings.create({
        model: EMBED_MODEL,
        input: texts,
        dimensions: rag_1.EMBEDDING_DIMS,
    });
    const out = [];
    for (const item of res.data) {
        if (!item.embedding || item.embedding.length === 0) {
            throw new Error("[openrouterEmbedder] empty embedding in batch");
        }
        out.push((0, rag_1.l2Normalize)(item.embedding));
    }
    return out;
}
function createOpenRouterEmbedder() {
    return {
        embedQuery: embedOne,
        embedDocuments: embedBatch,
    };
}
