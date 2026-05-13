"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_MODEL = exports.SIMILARITY_THRESHOLD = exports.RETRIEVER_K = exports.CHUNK_OVERLAP = exports.CHUNK_SIZE = exports.EMBEDDING_DIMS = exports.EMBEDDING_MODEL = void 0;
exports.getGoogleApiKey = getGoogleApiKey;
exports.getOpenAIApiKey = getOpenAIApiKey;
exports.getAnthropicApiKey = getAnthropicApiKey;
exports.assertRagSecrets = assertRagSecrets;
exports.l2Normalize = l2Normalize;
exports.EMBEDDING_MODEL = "gemini-embedding-001";
// Gemini MRL: 1536 dims entregam a mesma pontuação de 3072 em benchmarks
// oficiais (https://ai.google.dev/gemini-api/docs/embeddings). Dims < 3072
// exigem normalização L2 no cliente antes de persistir/consultar.
exports.EMBEDDING_DIMS = 1536;
exports.CHUNK_SIZE = 800;
exports.CHUNK_OVERLAP = 120;
// RETRIEVER_K = 6: cobertura ampla para perguntas genéricas.
exports.RETRIEVER_K = 6;
// Threshold relaxado de 0.55 → 0.45 (2026-05-07) para permitir mais
// correspondências fuzzy e evitar transferências desnecessárias para humano.
// O system prompt anti-alucinação impede que o LLM invente informações.
const DEFAULT_SIMILARITY_THRESHOLD = 0.45;
function resolveSimilarityThreshold() {
    const raw = process.env.EVAL_SIMILARITY_THRESHOLD;
    if (!raw || raw.trim() === "")
        return DEFAULT_SIMILARITY_THRESHOLD;
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 1)
        return DEFAULT_SIMILARITY_THRESHOLD;
    return parsed;
}
exports.SIMILARITY_THRESHOLD = resolveSimilarityThreshold();
exports.CHAT_MODEL = "google/gemini-2.5-flash";
function requireEnv(name) {
    const value = process.env[name];
    if (!value || value.trim() === "") {
        throw new Error(`[rag-config] Missing required environment variable: ${name}. ` +
            `Set it in your .env (loaded via dotenv) before starting the worker or running the ingestion/eval scripts.`);
    }
    return value;
}
function getGoogleApiKey() {
    return requireEnv("GOOGLE_API_KEY");
}
// Mantidos como opcionais para compat com código legado (leadExtractionService etc.).
// Não são mais exigidos pelo pipeline RAG principal.
function getOpenAIApiKey() {
    return requireEnv("OPENAI_API_KEY");
}
function getAnthropicApiKey() {
    return requireEnv("ANTHROPIC_API_KEY");
}
function assertRagSecrets() {
    getGoogleApiKey();
}
/**
 * Normaliza um vetor via L2 para norma unitária. Necessário para Gemini embeddings
 * com output_dimensionality < 3072 (o único tamanho pré-normalizado pela API).
 * Sem isso, a distância cosseno no pgvector degrada silenciosamente.
 */
function l2Normalize(vector) {
    let sumSq = 0;
    for (let i = 0; i < vector.length; i++)
        sumSq += vector[i] * vector[i];
    const norm = Math.sqrt(sumSq);
    if (norm === 0)
        return vector.slice();
    const out = new Array(vector.length);
    for (let i = 0; i < vector.length; i++)
        out[i] = vector[i] / norm;
    return out;
}
