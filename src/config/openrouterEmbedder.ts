import OpenAI from "openai";
import { EMBEDDING_DIMS, l2Normalize } from "./rag";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`[openrouterEmbedder] Missing env: ${name}`);
  }
  return value;
}

let clientCache: OpenAI | null = null;

function getClient(): OpenAI {
  if (clientCache) return clientCache;
  clientCache = new OpenAI({
    apiKey: requireEnv("OPENROUTER_API_KEY"),
    baseURL: "https://openrouter.ai/api/v1",
  });
  return clientCache;
}

// Usa o mesmo modelo Gemini via OpenRouter — embeddings compatíveis
// com o que já foi ingerido (1536 dims, L2 normalized).
const EMBED_MODEL = "google/gemini-embedding-001";

async function embedOne(text: string): Promise<number[]> {
  const client = getClient();
  const res = await client.embeddings.create({
    model: EMBED_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMS,
  } as any);
  const vector = res.data?.[0]?.embedding;
  if (!vector || vector.length === 0) {
    throw new Error("[openrouterEmbedder] empty embedding");
  }
  return l2Normalize(vector);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getClient();
  const res = await client.embeddings.create({
    model: EMBED_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMS,
  } as any);
  const out: number[][] = [];
  for (const item of res.data) {
    if (!item.embedding || item.embedding.length === 0) {
      throw new Error("[openrouterEmbedder] empty embedding in batch");
    }
    out.push(l2Normalize(item.embedding));
  }
  return out;
}

export interface EmbedderAdapter {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

export function createOpenRouterEmbedder(): EmbedderAdapter {
  return {
    embedQuery: embedOne,
    embedDocuments: embedBatch,
  };
}
