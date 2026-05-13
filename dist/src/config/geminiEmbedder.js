"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGeminiEmbedder = createGeminiEmbedder;
const genai_1 = require("@google/genai");
const rag_1 = require("./rag");
function createGeminiEmbedder() {
    const apiKey = (0, rag_1.getGoogleApiKey)();
    const client = new genai_1.GoogleGenAI({ apiKey });
    async function embedOne(text, taskType, title) {
        const res = await client.models.embedContent({
            model: rag_1.EMBEDDING_MODEL,
            contents: text,
            config: {
                outputDimensionality: rag_1.EMBEDDING_DIMS,
                taskType,
                ...(taskType === "RETRIEVAL_DOCUMENT" && title ? { title } : {}),
            },
        });
        const values = res.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
            throw new Error(`[geminiEmbedder] empty embedding for input (model=${rag_1.EMBEDDING_MODEL}, dims=${rag_1.EMBEDDING_DIMS}, task=${taskType})`);
        }
        if (values.length !== rag_1.EMBEDDING_DIMS) {
            throw new Error(`[geminiEmbedder] expected ${rag_1.EMBEDDING_DIMS} dims, got ${values.length}`);
        }
        return (0, rag_1.l2Normalize)(values);
    }
    async function embedDocumentsBatch(texts) {
        const out = [];
        // Gemini aceita array de strings para batch embedding — 1 API call
        // para N textos, respeitando o rate limit de 100 RPM do free tier.
        for (let start = 0; start < texts.length; start += 100) {
            const batch = texts.slice(start, start + 100);
            const res = await client.models.embedContent({
                model: rag_1.EMBEDDING_MODEL,
                contents: batch,
                config: {
                    outputDimensionality: rag_1.EMBEDDING_DIMS,
                    taskType: "RETRIEVAL_DOCUMENT",
                },
            });
            const batchEmbeddings = res.embeddings;
            if (!batchEmbeddings || batchEmbeddings.length !== batch.length) {
                throw new Error(`[geminiEmbedder] batch embedding mismatch: expected ${batch.length}, got ${batchEmbeddings?.length ?? 0}`);
            }
            for (const emb of batchEmbeddings) {
                const values = emb.values;
                if (!values || values.length === 0) {
                    throw new Error("[geminiEmbedder] empty embedding in batch");
                }
                if (values.length !== rag_1.EMBEDDING_DIMS) {
                    throw new Error(`[geminiEmbedder] expected ${rag_1.EMBEDDING_DIMS} dims, got ${values.length}`);
                }
                out.push((0, rag_1.l2Normalize)(values));
            }
        }
        return out;
    }
    async function embedDocumentsWithTitlesBatch(docs) {
        const out = new Array(docs.length);
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
