export const EMBEDDING_MODEL = "gemini-embedding-001" as const;
// Gemini MRL: 1536 dims entregam a mesma pontuação de 3072 em benchmarks
// oficiais (https://ai.google.dev/gemini-api/docs/embeddings). Dims < 3072
// exigem normalização L2 no cliente antes de persistir/consultar.
export const EMBEDDING_DIMS = 1536 as const;
export const CHUNK_SIZE = 800 as const;
export const CHUNK_OVERLAP = 120 as const;
// RETRIEVER_K = 6: cobertura ampla para perguntas genéricas.
export const RETRIEVER_K = 6 as const;
// Threshold relaxado de 0.55 → 0.45 (2026-05-07) para permitir mais
// correspondências fuzzy e evitar transferências desnecessárias para humano.
// O system prompt anti-alucinação impede que o LLM invente informações.
const DEFAULT_SIMILARITY_THRESHOLD = 0.45;
function resolveSimilarityThreshold(): number {
  const raw = process.env.EVAL_SIMILARITY_THRESHOLD;
  if (!raw || raw.trim() === "") return DEFAULT_SIMILARITY_THRESHOLD;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) return DEFAULT_SIMILARITY_THRESHOLD;
  return parsed;
}
export const SIMILARITY_THRESHOLD = resolveSimilarityThreshold();
export const CHAT_MODEL = "google/gemini-2.5-flash" as const;

export type RagConfig = {
  EMBEDDING_MODEL: typeof EMBEDDING_MODEL;
  EMBEDDING_DIMS: typeof EMBEDDING_DIMS;
  CHUNK_SIZE: typeof CHUNK_SIZE;
  CHUNK_OVERLAP: typeof CHUNK_OVERLAP;
  RETRIEVER_K: typeof RETRIEVER_K;
  SIMILARITY_THRESHOLD: typeof SIMILARITY_THRESHOLD;
  CHAT_MODEL: typeof CHAT_MODEL;
};

type RequiredEnvName = "GOOGLE_API_KEY" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY";

function requireEnv(name: RequiredEnvName): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `[rag-config] Missing required environment variable: ${name}. ` +
        `Set it in your .env (loaded via dotenv) before starting the worker or running the ingestion/eval scripts.`,
    );
  }
  return value;
}

export function getGoogleApiKey(): string {
  return requireEnv("GOOGLE_API_KEY");
}

// Mantidos como opcionais para compat com código legado (leadExtractionService etc.).
// Não são mais exigidos pelo pipeline RAG principal.
export function getOpenAIApiKey(): string {
  return requireEnv("OPENAI_API_KEY");
}

export function getAnthropicApiKey(): string {
  return requireEnv("ANTHROPIC_API_KEY");
}

export function assertRagSecrets(): void {
  getGoogleApiKey();
}

/**
 * Normaliza um vetor via L2 para norma unitária. Necessário para Gemini embeddings
 * com output_dimensionality < 3072 (o único tamanho pré-normalizado pela API).
 * Sem isso, a distância cosseno no pgvector degrada silenciosamente.
 */
export function l2Normalize(vector: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vector.length; i++) sumSq += vector[i] * vector[i];
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vector.slice();
  const out = new Array<number>(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}
