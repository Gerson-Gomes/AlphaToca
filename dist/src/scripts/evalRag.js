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
exports.runEvaluation = runEvaluation;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const db_1 = __importDefault(require("../config/db"));
const rag_1 = require("../config/rag");
const ragChainService_1 = require("../services/ragChainService");
const ragRetrieverService_1 = require("../services/ragRetrieverService");
const QUESTIONS = [
    "Como funciona o processo de triagem de inquilinos no AlphaToca?",
    "Quais documentos preciso enviar para alugar um imóvel?",
    "Posso agendar uma visita para amanhã de manhã?",
    "Qual é a forma de pagamento do aluguel todo mês?",
    "Aceitam animais de estimação nos imóveis?",
    "Como faço para rescindir o contrato antes do prazo?",
    "Quem paga as taxas de condomínio e IPTU?",
    "O AlphaToca cobra alguma taxa do inquilino no início do contrato?",
];
// Preços Gemini 2.5 Flash (abr/2026, USD por 1M tokens, <=200k tok prompt).
const PRICE_CHAT_INPUT_PER_MTOK = 0.15;
const PRICE_CHAT_OUTPUT_PER_MTOK = 0.6;
// Preço gemini-embedding-001 (USD por 1M tokens).
const PRICE_EMBEDDING_PER_MTOK = 0.15;
// Heurística: 1 token ≈ 4 chars em PT-BR (aproxima o tokenizer Gemini).
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function truncate(text, max) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= max)
        return normalized;
    return `${normalized.slice(0, max - 1)}…`;
}
function percentile(sorted, p) {
    if (sorted.length === 0)
        return 0;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
}
async function runEvaluation(questions) {
    const sessionId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Free tier gemini-2.5-flash = 5 RPM. Espaçamos as chamadas com folga
    // pra evitar 429. Override via EVAL_INTER_QUESTION_DELAY_MS.
    const interDelayMs = Number.parseInt(process.env.EVAL_INTER_QUESTION_DELAY_MS || "14000", 10);
    console.log(`[eval:rag] SIMILARITY_THRESHOLD=${rag_1.SIMILARITY_THRESHOLD} · delay entre perguntas=${interDelayMs}ms`);
    const results = [];
    for (let i = 0; i < questions.length; i++) {
        if (i > 0 && interDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, interDelayMs));
        }
        const question = questions[i];
        console.log(`\n=== [${i + 1}/${questions.length}] ${question} ===`);
        const r = {
            index: i + 1,
            question,
            topTitle: "(nenhum chunk recuperado)",
            topScore: 0,
            handoff: false,
            answer: "",
            retrieverMs: 0,
            chainMs: 0,
            totalMs: 0,
            promptTokensEst: estimateTokens(question),
            outputTokensEst: 0,
        };
        const tRetrieverStart = Date.now();
        try {
            const chunks = await (0, ragRetrieverService_1.retrieveRelevantChunks)(question);
            r.retrieverMs = Date.now() - tRetrieverStart;
            if (chunks.length > 0) {
                r.topTitle = chunks[0].title;
                r.topScore = chunks[0].score;
                // Adiciona tokens dos chunks ao prompt estimado.
                r.promptTokensEst += chunks.reduce((acc, c) => acc + estimateTokens(c.content), 0);
            }
        }
        catch (err) {
            r.retrieverMs = Date.now() - tRetrieverStart;
            r.error = `[retriever] ${err.message}`;
            console.error(`  [retriever error] ${r.error}`);
        }
        const tChainStart = Date.now();
        try {
            const result = await (0, ragChainService_1.generateAnswer)({ sessionId, userMessage: question });
            r.chainMs = Date.now() - tChainStart;
            r.handoff = result.handoff;
            r.answer = result.answer;
            r.outputTokensEst = estimateTokens(result.answer);
            // Usa o topScore retornado pelo chain se o retriever falhou antes.
            if (r.topScore === 0)
                r.topScore = result.topScore;
            console.log(`  top chunk:    ${r.topTitle}`);
            console.log(`  similarity:   ${r.topScore.toFixed(3)}`);
            console.log(`  handoff:      ${r.handoff}`);
            console.log(`  retriever ms: ${r.retrieverMs}`);
            console.log(`  chain ms:     ${r.chainMs}`);
            console.log(`  answer:       ${truncate(r.answer, 500)}`);
        }
        catch (err) {
            r.chainMs = Date.now() - tChainStart;
            r.error = `${r.error ?? ""} [chain] ${err.message}`.trim();
            console.error(`  [chain error] ${err.message}`);
        }
        r.totalMs = r.retrieverMs + r.chainMs;
        results.push(r);
    }
    return results;
}
function buildReport(results) {
    const successes = results.filter((r) => !r.error && r.answer.length > 0);
    const totals = results.map((r) => r.totalMs).sort((a, b) => a - b);
    const chains = results.map((r) => r.chainMs).sort((a, b) => a - b);
    const avg = (arr) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
    const handoffs = results.filter((r) => r.handoff).length;
    const totalPromptTok = results.reduce((acc, r) => acc + r.promptTokensEst, 0);
    const totalOutputTok = results.reduce((acc, r) => acc + r.outputTokensEst, 0);
    const costPerRun = (totalPromptTok / 1_000_000) * PRICE_CHAT_INPUT_PER_MTOK +
        (totalPromptTok / 1_000_000) * PRICE_EMBEDDING_PER_MTOK + // embedding da query
        (totalOutputTok / 1_000_000) * PRICE_CHAT_OUTPUT_PER_MTOK;
    // Para 1k conversas: assumimos que cada conversa ≈ 1 pergunta.
    const avgPromptPerQ = totalPromptTok / results.length;
    const avgOutputPerQ = totalOutputTok / results.length;
    const costPer1kConversas = (avgPromptPerQ * 1000) / 1_000_000 * PRICE_CHAT_INPUT_PER_MTOK +
        (avgPromptPerQ * 1000) / 1_000_000 * PRICE_EMBEDDING_PER_MTOK +
        (avgOutputPerQ * 1000) / 1_000_000 * PRICE_CHAT_OUTPUT_PER_MTOK;
    const lines = [];
    lines.push(`# Benchmark — Gemini 2.5 Flash + gemini-embedding-001 (${rag_1.EMBEDDING_DIMS} dims)`);
    lines.push("");
    lines.push(`**Data:** ${new Date().toISOString()}`);
    lines.push(`**Chat model:** ${rag_1.CHAT_MODEL}`);
    lines.push(`**Embedding model:** ${rag_1.EMBEDDING_MODEL} @ ${rag_1.EMBEDDING_DIMS} dims (normalizado L2 no cliente)`);
    lines.push(`**Perguntas:** ${results.length}`);
    lines.push("");
    lines.push("## Resumo");
    lines.push("");
    lines.push(`- Sucesso: ${successes.length}/${results.length}`);
    lines.push(`- Handoff rate: ${handoffs}/${results.length} (${((handoffs / results.length) * 100).toFixed(1)}%)`);
    lines.push(`- Latência média total: ${avg(totals).toFixed(0)} ms`);
    lines.push(`- Latência p95 total: ${percentile(totals, 95).toFixed(0)} ms`);
    lines.push(`- Latência média chain (LLM): ${avg(chains).toFixed(0)} ms`);
    lines.push(`- Latência p95 chain (LLM): ${percentile(chains, 95).toFixed(0)} ms`);
    lines.push(`- Top-score médio: ${avg(results.map((r) => r.topScore)).toFixed(3)}`);
    lines.push("");
    lines.push("## Custo estimado");
    lines.push("");
    lines.push(`- Custo desta execução (${results.length} Q): US$ ${costPerRun.toFixed(6)}`);
    lines.push(`- Projeção por 1.000 conversas: **US$ ${costPer1kConversas.toFixed(4)}**`);
    lines.push(`- Projeção por 10.000 conversas: **US$ ${(costPer1kConversas * 10).toFixed(4)}**`);
    lines.push(`- Preços (USD/M tok): input chat $${PRICE_CHAT_INPUT_PER_MTOK} · output chat $${PRICE_CHAT_OUTPUT_PER_MTOK} · embedding $${PRICE_EMBEDDING_PER_MTOK}`);
    lines.push("");
    lines.push("## Resultados por pergunta");
    lines.push("");
    lines.push("| # | Pergunta | Top score | Handoff | Retriever ms | Chain ms | Resposta (trecho) |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const r of results) {
        lines.push(`| ${r.index} | ${r.question} | ${r.topScore.toFixed(3)} | ${r.handoff ? "sim" : "não"} | ${r.retrieverMs} | ${r.chainMs} | ${truncate(r.answer, 160).replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
    lines.push("## Respostas completas (para avaliação manual PT-BR)");
    lines.push("");
    for (const r of results) {
        lines.push(`### ${r.index}. ${r.question}`);
        lines.push("");
        lines.push(`- **Top chunk:** ${r.topTitle} (score=${r.topScore.toFixed(3)})`);
        lines.push(`- **Handoff:** ${r.handoff}`);
        lines.push(`- **Latência total:** ${r.totalMs} ms (retriever=${r.retrieverMs}, chain=${r.chainMs})`);
        if (r.error)
            lines.push(`- **Erro:** ${r.error}`);
        lines.push("");
        lines.push("```");
        lines.push(r.answer || "(sem resposta)");
        lines.push("```");
        lines.push("");
    }
    return lines.join("\n");
}
async function main() {
    (0, rag_1.assertRagSecrets)();
    console.log(`[eval:rag] running ${QUESTIONS.length} questions against the RAG pipeline...`);
    const results = await runEvaluation(QUESTIONS);
    const report = buildReport(results);
    const suffix = rag_1.SIMILARITY_THRESHOLD.toFixed(2).replace(".", "");
    const outPath = path.resolve(__dirname, "..", "..", "..", "docs", `benchmark_gemini_rag_t${suffix}.md`);
    await fs_1.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs_1.promises.writeFile(outPath, report, "utf8");
    console.log(`\n[eval:rag] done. Relatório salvo em ${outPath}`);
}
if (require.main === module) {
    main()
        .catch((err) => {
        console.error("[eval:rag] failed:", err);
        process.exitCode = 1;
    })
        .finally(async () => {
        await db_1.default.$disconnect();
    });
}
