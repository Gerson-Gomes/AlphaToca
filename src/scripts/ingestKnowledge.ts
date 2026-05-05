import { promises as fs } from "fs";
import * as path from "path";
import { createHash } from "crypto";

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { PrismaClient } from "@prisma/client";

import prisma from "../config/db";
import { createGeminiEmbedder } from "../config/geminiEmbedder";
import { CHUNK_OVERLAP, CHUNK_SIZE } from "../config/rag";

export interface ChunkRecord {
  sourcePath: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  title: string;
}

export interface IngestSummary {
  files: number;
  inserted: number;
  updated: number;
  skipped: number;
  deleted: number;
}

export interface Embedder {
  embedDocuments(texts: string[]): Promise<number[][]>;
}

export interface TextChunker {
  splitText(text: string): Promise<string[]>;
}

export type PrismaIngestClient = Pick<
  PrismaClient,
  "$queryRawUnsafe" | "$executeRawUnsafe"
>;

export const EMBEDDING_BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE ?? 100);

export interface IngestDeps {
  prisma: PrismaIngestClient;
  embedder: Embedder;
  splitter: TextChunker;
  listMarkdownFiles: () => Promise<string[]>;
  readFile: (filePath: string) => Promise<string>;
}

interface ExistingRow {
  id: string;
  source_path: string;
  chunk_index: number;
  content_hash: string;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function deriveTitle(filePath: string, chunkIndex: number): string {
  const base = path.basename(filePath, path.extname(filePath));
  return `${base}#${chunkIndex}`;
}

// Serializa um vetor no formato textual aceito pelo pgvector: "[n1,n2,...]".
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

export async function listMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && full.toLowerCase().endsWith(".md")) {
        out.push(full);
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}

export async function buildChunksForFile(
  filePath: string,
  text: string,
  splitter: TextChunker,
): Promise<ChunkRecord[]> {
  const pieces = await splitter.splitText(text);
  return pieces.map((content, chunkIndex) => ({
    sourcePath: filePath,
    chunkIndex,
    content,
    contentHash: hashContent(content),
    title: deriveTitle(filePath, chunkIndex),
  }));
}

export async function runIngestion(deps: IngestDeps): Promise<IngestSummary> {
  const files = await deps.listMarkdownFiles();
  const summary: IngestSummary = {
    files: files.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
  };

  const allChunks: ChunkRecord[] = [];
  for (const file of files) {
    const text = await deps.readFile(file);
    const chunks = await buildChunksForFile(file, text, deps.splitter);
    allChunks.push(...chunks);
  }

  if (allChunks.length === 0) {
    return summary;
  }

  const embeddings: number[][] = [];
  for (let start = 0; start < allChunks.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = allChunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    const vectors = await deps.embedder.embedDocuments(
      batch.map((c) => c.content),
    );
    if (vectors.length !== batch.length) {
      throw new Error(
        `[ingest:knowledge] embedder returned ${vectors.length} vectors for ${batch.length} chunks in batch starting at ${start}`,
      );
    }
    embeddings.push(...vectors);
  }

  if (embeddings.length !== allChunks.length) {
    throw new Error(
      `[ingest:knowledge] embedder returned ${embeddings.length} vectors for ${allChunks.length} chunks`,
    );
  }

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    const vectorLiteral = toVectorLiteral(embeddings[i]);

    await deps.prisma.$executeRawUnsafe(
      `INSERT INTO knowledge_documents
         (id, title, content, embedding, source_path, chunk_index, content_hash, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3::vector, $4, $5, $6, now())
       ON CONFLICT (source_path, chunk_index)
       DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         content_hash = EXCLUDED.content_hash,
         updated_at = now()`,
      chunk.title,
      chunk.content,
      vectorLiteral,
      chunk.sourcePath,
      chunk.chunkIndex,
      chunk.contentHash,
    );
    summary.inserted++;
  }

  const sourcePaths = Array.from(new Set(allChunks.map((c) => c.sourcePath)));
  const desiredSet = new Set(
    allChunks.map((c) => `${c.sourcePath}|${c.chunkIndex}`),
  );

  const existingRows = await deps.prisma.$queryRawUnsafe<ExistingRow[]>(
    `SELECT id, source_path, chunk_index, content_hash
     FROM knowledge_documents
     WHERE source_path = ANY($1::text[])`,
    sourcePaths,
  );

  for (const row of existingRows) {
    if (!desiredSet.has(`${row.source_path}|${row.chunk_index}`)) {
      await deps.prisma.$executeRawUnsafe(
        `DELETE FROM knowledge_documents WHERE id = $1`,
        row.id,
      );
      summary.deleted++;
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const docsRoot = path.resolve(__dirname, "..", "..", "documentation");

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });

  const embedder = createGeminiEmbedder();

  const summary = await runIngestion({
    prisma,
    embedder: {
      embedDocuments: (texts) => embedder.embedDocuments(texts),
    },
    splitter: {
      splitText: (text) => splitter.splitText(text),
    },
    listMarkdownFiles: () => listMarkdownFiles(docsRoot),
    readFile: (filePath) => fs.readFile(filePath, "utf8"),
  });

  console.log(
    `[ingest:knowledge] files=${summary.files} inserted=${summary.inserted} updated=${summary.updated} skipped=${summary.skipped} deleted=${summary.deleted}`,
  );
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("[ingest:knowledge] failed:", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
