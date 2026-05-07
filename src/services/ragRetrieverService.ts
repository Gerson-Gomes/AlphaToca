import type { PrismaClient } from "@prisma/client";

import prisma from "../config/db";
import { createOpenRouterEmbedder } from "../config/openrouterEmbedder";
import { RETRIEVER_K } from "../config/rag";

export interface RetrievedChunk {
  id: string;
  content: string;
  title: string;
  score: number;
}

export interface QueryEmbedder {
  embedQuery(text: string): Promise<number[]>;
}

export type PrismaRetrieverClient = Pick<PrismaClient, "$queryRawUnsafe">;

export interface RetrieverDeps {
  prisma: PrismaRetrieverClient;
  embedder: QueryEmbedder;
  k?: number;
}

interface RetrievedRow {
  id: string;
  content: string;
  title: string;
  distance: number | string;
}

// Expansão de query: mapeia termos comuns do usuário para sinônimos
// presentes nos documentos, melhorando a similaridade semântica.
const QUERY_EXPANSION_MAP: Record<string, string> = {
  "cancelar": "rescisão",
  "cancelamento": "rescisão",
  "rescindir": "cancelar",
  "rescisão": "cancelamento",
  "alugar": "aluguel",
  "aluguel": "alugar",
  "visitar": "visita agendar",
  "visita": "visitar agendar",
  "contrato": "documento",
  "documento": "contrato",
  "multa": "rescisão",
  "taxa": "comissão",
  "pagamento": "boleto repasse",
  "boleto": "pagamento",
  "comissão": "taxa repasse",
  "repasse": "pagamento comissão",
  "proprietário": "locador",
  "inquilino": "locatário",
  "imóvel": "apartamento casa",
  "caução": "depósito garantia",
  "depósito": "caução",
  "sair": "rescisão",
};

function expandQuery(query: string): string {
  const words = query.toLowerCase().split(/\s+/);
  const expanded = new Set<string>(words);

  for (const word of words) {
    // Tenta match exato
    if (QUERY_EXPANSION_MAP[word]) {
      QUERY_EXPANSION_MAP[word].split(/\s+/).forEach((w) => expanded.add(w));
    }
    // Tenta match sem acentos (ex: "cancelamento" vs mapa com acento)
    const normalized = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normalized !== word && QUERY_EXPANSION_MAP[normalized]) {
      QUERY_EXPANSION_MAP[normalized].split(/\s+/).forEach((w) => expanded.add(w));
    }
  }

  return Array.from(expanded).join(" ");
}

// Serializa um vetor no formato textual aceito pelo pgvector. Ver comentário
// equivalente em src/scripts/ingestKnowledge.ts — validação estrita é proposital.
export function toVectorLiteral(vector: number[]): string {
  if (!Array.isArray(vector)) {
    throw new Error("[toVectorLiteral] vector must be a number[]");
  }
  for (let i = 0; i < vector.length; i++) {
    const v = vector[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(
        `[toVectorLiteral] invalid component at index ${i}: ${String(v)}`,
      );
    }
  }
  return `[${vector.join(",")}]`;
}

let defaultDepsCache: RetrieverDeps | null = null;

function getDefaultDeps(): RetrieverDeps {
  if (defaultDepsCache) return defaultDepsCache;
  const embedder = createOpenRouterEmbedder();
  defaultDepsCache = {
    prisma,
    embedder: {
      embedQuery: (text) => embedder.embedQuery(text),
    },
  };
  return defaultDepsCache;
}

export async function retrieveRelevantChunks(
  query: string,
  overrideDeps?: RetrieverDeps,
): Promise<RetrievedChunk[]> {
  if (typeof query !== "string" || query.trim() === "") {
    return [];
  }

  const deps = overrideDeps ?? getDefaultDeps();
  const k = deps.k ?? RETRIEVER_K;

  // Expande a query com sinônimos para melhorar a similaridade semântica
  // (ex: "cancelar contrato" → "cancelar contrato rescisão multa encerramento")
  const expandedQuery = expandQuery(query);
  const vector = await deps.embedder.embedQuery(expandedQuery);
  const vectorLiteral = toVectorLiteral(vector);

  // Busca semântica (pgvector cosine distance)
  const semanticRows = await deps.prisma.$queryRawUnsafe<RetrievedRow[]>(
    `SELECT id, content, title, (embedding <=> $1::vector) AS distance
       FROM knowledge_documents
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $2`,
    vectorLiteral,
    k * 2, // Busca 2x mais para ter margem depois de merge
  );

  // Busca por texto: extrai palavras-chave (>= 4 letras) da query original
  // como fallback para quando a similaridade semântica falha.
  const keywords = extractKeywords(query);
  let textRows: RetrievedRow[] = [];
  if (keywords.length > 0) {
    const ilikeConditions = keywords
      .map((_, i) => `content ILIKE $${i + 3}`)
      .join(" OR ");
    const ilikeParams = keywords.map((kw) => `%${kw}%`);
    try {
      textRows = await deps.prisma.$queryRawUnsafe<RetrievedRow[]>(
        `SELECT id, content, title, 0.5::float8 AS distance
           FROM knowledge_documents
          WHERE embedding IS NOT NULL
            AND (${ilikeConditions})
          ORDER BY length(content) ASC
          LIMIT $${keywords.length + 3}`,
        vectorLiteral,
        k,
        ...ilikeParams,
        k,
      );
    } catch {
      // Se a busca por texto falhar (ex: SQL injection safe), ignora
    }
  }

  // Merge: deduplica por id, mantendo a menor distância (maior score)
  const seen = new Map<string, RetrievedRow>();
  for (const row of [...semanticRows, ...textRows]) {
    const existing = seen.get(row.id);
    if (!existing || Number(row.distance) < Number(existing.distance)) {
      seen.set(row.id, row);
    }
  }

  // Ordena por score (1 - distance) decrescente e limita a K
  const merged = Array.from(seen.values())
    .map((row) => {
      const distance =
        typeof row.distance === "string"
          ? parseFloat(row.distance)
          : row.distance;
      const score = 1 - distance;
      return { id: row.id, content: row.content, title: row.title, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return merged;
}

function extractKeywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[\s,.;:!?]+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !/^(como|para|que|mais|tem|uma|isso|onde|qual|qualquer|muito)$/i.test(w),
    );

  // Adiciona sinônimos das palavras-chave
  const expanded = new Set(words);
  for (const word of words) {
    const map = QUERY_EXPANSION_MAP[word];
    if (map) {
      map.split(/\s+/).forEach((w) => expanded.add(w));
    }
  }

  // Remove duplicatas que são substrings de outras palavras
  const unique = Array.from(expanded)
    .sort((a, b) => b.length - a.length)
    .filter(
      (kw, i, arr) => !arr.some((other, j) => j < i && other.includes(kw)),
    )
    .slice(0, 6);

  return unique;
}
