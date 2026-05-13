"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMBEDDING_BATCH_SIZE = void 0;
exports.hashContent = hashContent;
exports.deriveTitle = deriveTitle;
exports.toVectorLiteral = toVectorLiteral;
exports.listMarkdownFiles = listMarkdownFiles;
exports.buildChunksForFile = buildChunksForFile;
exports.runIngestion = runIngestion;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const textsplitters_1 = require("@langchain/textsplitters");
const db_1 = __importDefault(require("../config/db"));
const openrouterEmbedder_1 = require("../config/openrouterEmbedder");
const rag_1 = require("../config/rag");
exports.EMBEDDING_BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE ?? 100);
function hashContent(content) {
    return (0, crypto_1.createHash)("sha256").update(content, "utf8").digest("hex");
}
function deriveTitle(filePath, chunkIndex) {
    const base = path.basename(filePath, path.extname(filePath));
    return `${base}#${chunkIndex}`;
}
// Serializa um vetor no formato textual aceito pelo pgvector: "[n1,n2,...]".
function toVectorLiteral(vector) {
    if (!Array.isArray(vector)) {
        throw new Error("[toVectorLiteral] vector must be a number[]");
    }
    for (let i = 0; i < vector.length; i++) {
        const v = vector[i];
        if (typeof v !== "number" || !Number.isFinite(v)) {
            throw new Error(`[toVectorLiteral] invalid component at index ${i}: ${String(v)}`);
        }
    }
    return `[${vector.join(",")}]`;
}
async function listMarkdownFiles(root) {
    const out = [];
    async function walk(dir) {
        let entries;
        try {
            entries = await fs_1.promises.readdir(dir, { withFileTypes: true });
        }
        catch (err) {
            const code = err.code;
            if (code === "ENOENT")
                return;
            throw err;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            }
            else if (entry.isFile() && full.toLowerCase().endsWith(".md")) {
                out.push(full);
            }
        }
    }
    await walk(root);
    out.sort();
    return out;
}
async function buildChunksForFile(filePath, text, splitter) {
    const pieces = await splitter.splitText(text);
    return pieces.map((content, chunkIndex) => ({
        sourcePath: filePath,
        chunkIndex,
        content,
        contentHash: hashContent(content),
        title: deriveTitle(filePath, chunkIndex),
    }));
}
async function runIngestion(deps) {
    const files = await deps.listMarkdownFiles();
    const summary = {
        files: files.length,
        inserted: 0,
        updated: 0,
        skipped: 0,
        deleted: 0,
    };
    const allChunks = [];
    for (const file of files) {
        const text = await deps.readFile(file);
        const chunks = await buildChunksForFile(file, text, deps.splitter);
        allChunks.push(...chunks);
    }
    if (allChunks.length === 0) {
        return summary;
    }
    const embeddings = [];
    for (let start = 0; start < allChunks.length; start += exports.EMBEDDING_BATCH_SIZE) {
        const batch = allChunks.slice(start, start + exports.EMBEDDING_BATCH_SIZE);
        const vectors = await deps.embedder.embedDocuments(batch.map((c) => c.content));
        if (vectors.length !== batch.length) {
            throw new Error(`[ingest:knowledge] embedder returned ${vectors.length} vectors for ${batch.length} chunks in batch starting at ${start}`);
        }
        embeddings.push(...vectors);
    }
    if (embeddings.length !== allChunks.length) {
        throw new Error(`[ingest:knowledge] embedder returned ${embeddings.length} vectors for ${allChunks.length} chunks`);
    }
    for (let i = 0; i < allChunks.length; i++) {
        const chunk = allChunks[i];
        const vectorLiteral = toVectorLiteral(embeddings[i]);
        await deps.prisma.$executeRawUnsafe(`INSERT INTO knowledge_documents
         (id, title, content, embedding, source_path, chunk_index, content_hash, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3::vector, $4, $5, $6, now())
       ON CONFLICT (source_path, chunk_index)
       DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         content_hash = EXCLUDED.content_hash,
         updated_at = now()`, chunk.title, chunk.content, vectorLiteral, chunk.sourcePath, chunk.chunkIndex, chunk.contentHash);
        summary.inserted++;
    }
    const sourcePaths = Array.from(new Set(allChunks.map((c) => c.sourcePath)));
    const desiredSet = new Set(allChunks.map((c) => `${c.sourcePath}|${c.chunkIndex}`));
    const existingRows = await deps.prisma.$queryRawUnsafe(`SELECT id, source_path, chunk_index, content_hash
     FROM knowledge_documents
     WHERE source_path = ANY($1::text[])`, sourcePaths);
    for (const row of existingRows) {
        if (!desiredSet.has(`${row.source_path}|${row.chunk_index}`)) {
            await deps.prisma.$executeRawUnsafe(`DELETE FROM knowledge_documents WHERE id = $1`, row.id);
            summary.deleted++;
        }
    }
    return summary;
}
async function main() {
    const docsRoot = path.resolve(__dirname, "..", "..", "documentation");
    const splitter = new textsplitters_1.RecursiveCharacterTextSplitter({
        chunkSize: rag_1.CHUNK_SIZE,
        chunkOverlap: rag_1.CHUNK_OVERLAP,
    });
    const embedder = (0, openrouterEmbedder_1.createOpenRouterEmbedder)();
    const summary = await runIngestion({
        prisma: db_1.default,
        embedder: {
            embedDocuments: (texts) => embedder.embedDocuments(texts),
        },
        splitter: {
            splitText: (text) => splitter.splitText(text),
        },
        listMarkdownFiles: () => listMarkdownFiles(docsRoot),
        readFile: (filePath) => fs_1.promises.readFile(filePath, "utf8"),
    });
    console.log(`[ingest:knowledge] files=${summary.files} inserted=${summary.inserted} updated=${summary.updated} skipped=${summary.skipped} deleted=${summary.deleted}`);
}
if (require.main === module) {
    main()
        .catch((err) => {
        console.error("[ingest:knowledge] failed:", err);
        process.exitCode = 1;
    })
        .finally(async () => {
        await db_1.default.$disconnect();
    });
}
