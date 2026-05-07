import { GoogleGenAI } from "@google/genai";

import {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  getGoogleApiKey,
  l2Normalize,
} from "./rag";

/**
 * Adapter mínimo sobre o SDK oficial `@google/genai` que expõe os métodos
 * `embedQuery` e `embedDocuments` no mesmo formato consumido pelo projeto.
 *
 * O wrapper `GoogleGenerativeAIEmbeddings` do `@langchain/google-genai` usa
 * internamente o SDK legado `@google/generative-ai`, que NÃO suporta o
 * parâmetro `outputDimensionality`. Como Gemini `embedding-001` retorna
 * vetores de 3072 dims por padrão e a equipe decidiu usar 1536 dims,
 * precisamos falar direto com o SDK novo.
 *
 * Observação: para dims < 3072, Gemini NÃO pré-normaliza o vetor — é
 * obrigatório normalizar via L2 antes de indexar/consultar para que a
 * distância cosseno no pgvector produza scores comparáveis.
 */
/**
 * TaskTypes otimizam o vetor para o caso de uso. Para RAG:
 * - `RETRIEVAL_DOCUMENT`: aplicado na INGESTÃO (cada chunk da KB).
 * - `RETRIEVAL_QUERY`: aplicado na CONSULTA (pergunta do usuário).
 *
 * Documentos e queries devem sempre ser embedados com os task types
 * correspondentes; misturar (ex.: ingerir sem taskType e consultar com
 * RETRIEVAL_QUERY) produz similaridade degradada.
 */
export type EmbeddingTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING"
  | "QUESTION_ANSWERING"
  | "FACT_VERIFICATION";

export interface EmbedDocumentInput {
  content: string;
  title?: string; // apenas usado quando taskType = RETRIEVAL_DOCUMENT
}

export interface GeminiEmbedderAdapter {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedDocumentsWithTitles(docs: EmbedDocumentInput[]): Promise<number[][]>;
}

export function createGeminiEmbedder(): GeminiEmbedderAdapter {
  const apiKey = getGoogleApiKey();
  const client = new GoogleGenAI({ apiKey });

  async function embedOne(
    text: string,
    taskType: EmbeddingTaskType,
    title?: string,
  ): Promise<number[]> {
    const res = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: {
        outputDimensionality: EMBEDDING_DIMS,
        taskType,
        ...(taskType === "RETRIEVAL_DOCUMENT" && title ? { title } : {}),
      },
    });
    const values = res.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
      throw new Error(
        `[geminiEmbedder] empty embedding for input (model=${EMBEDDING_MODEL}, dims=${EMBEDDING_DIMS}, task=${taskType})`,
      );
    }
    if (values.length !== EMBEDDING_DIMS) {
      throw new Error(
        `[geminiEmbedder] expected ${EMBEDDING_DIMS} dims, got ${values.length}`,
      );
    }
    return l2Normalize(values);
  }

  async function embedDocumentsBatch(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    // Gemini aceita array de strings para batch embedding — 1 API call
    // para N textos, respeitando o rate limit de 100 RPM do free tier.
    for (let start = 0; start < texts.length; start += 100) {
      const batch = texts.slice(start, start + 100);
      const res = await client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: batch,
        config: {
          outputDimensionality: EMBEDDING_DIMS,
          taskType: "RETRIEVAL_DOCUMENT",
        },
      });
      const batchEmbeddings = res.embeddings;
      if (!batchEmbeddings || batchEmbeddings.length !== batch.length) {
        throw new Error(
          `[geminiEmbedder] batch embedding mismatch: expected ${batch.length}, got ${batchEmbeddings?.length ?? 0}`,
        );
      }
      for (const emb of batchEmbeddings) {
        const values = emb.values;
        if (!values || values.length === 0) {
          throw new Error("[geminiEmbedder] empty embedding in batch");
        }
        if (values.length !== EMBEDDING_DIMS) {
          throw new Error(
            `[geminiEmbedder] expected ${EMBEDDING_DIMS} dims, got ${values.length}`,
          );
        }
        out.push(l2Normalize(values));
      }
    }
    return out;
  }

  async function embedDocumentsWithTitlesBatch(
    docs: EmbedDocumentInput[],
  ): Promise<number[][]> {
    const out: number[][] = new Array(docs.length);
    for (let i = 0; i < docs.length; i++) {
      out[i] = await embedOne(docs[i].content, "RETRIEVAL_DOCUMENT", docs[i].title);
    }
    return out;
  }

  return {
    embedQuery: (text) => embedOne(text, "RETRIEVAL_QUERY"),
    embedDocuments: embedDocumentsBatch,
    embedDocumentsWithTitles: embedDocumentsWithTitlesBatch,
  };
}
