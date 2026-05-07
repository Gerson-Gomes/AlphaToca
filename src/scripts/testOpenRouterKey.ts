import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

async function main() {
  const apiKey = requireEnv("OPENROUTER_API_KEY");

  console.log("=".repeat(60));
  console.log("[TEST] Validando chave OpenRouter");
  console.log("=".repeat(60));
  console.log(`  Chave prefixo   : ${apiKey.substring(0, 12)}...`);
  console.log(`  Comprimento     : ${apiKey.length} chars`);
  console.log(`  Formato esperado: sk-or-v1-***`);
  console.log(`  Formato OK      : ${apiKey.startsWith("sk-or-v1-") ? "SIM" : "NAO — VERIFIQUE"}`);
  console.log("");

  const llm = new ChatOpenAI({
    modelName: "google/gemini-2.5-flash",
    apiKey,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
      defaultHeaders: {
        "HTTP-Referer": "https://i-moveis.com",
        "X-Title": "I-Moveis Bot",
      },
    },
    temperature: 0,
    maxTokens: 30,
  });

  console.log("[1] Construindo prompt de teste...");
  const messages = [
    new SystemMessage("Responda em português, no máximo 20 palavras."),
    new HumanMessage("Qual o significado de alugar um imóvel no I-Moveis?"),
  ];

  console.log("[2] Chamando OpenRouter (gemini-2.5-flash)...");
  const t0 = Date.now();
  let response;
  try {
    response = await llm.invoke(messages);
  } catch (err) {
    console.error("\n❌ ERRO NA CHAMADA:");
    console.error(err);
    process.exit(1);
  }
  const elapsed = Date.now() - t0;

  console.log("");
  console.log("=".repeat(60));
  console.log("[OPENROUTER] Resposta recebida");
  console.log("=".repeat(60));
  console.log(`  Latência        : ${elapsed}ms`);
  console.log(`  Conteúdo        : ${response.content}`);
  console.log("");

  const meta = response.response_metadata as Record<string, unknown> | undefined;
  if (meta) {
    console.log("[TOKEN USAGE] — visível em https://openrouter.ai/activity");
    console.log(`  response_metadata bruto: ${JSON.stringify(meta)}`);
  }

  console.log("");
  console.log("✅ API KEY VÁLIDA — chamada concluída com sucesso.");
  console.log(`   Verifique o consumo em: https://openrouter.ai/activity`);
  const usage = (meta as any).usage as Record<string, number> | undefined;
  console.log(`   Custo desta chamada: ~${elapsed}ms, ${usage?.total_tokens ?? "?"} tokens`);
}

main().catch((err) => {
  console.error("\n❌ FALHA CRÍTICA:");
  console.error(err);
  process.exit(1);
});
