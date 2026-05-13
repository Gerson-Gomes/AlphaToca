"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentApp = void 0;
exports.runAgentOrchestration = runAgentOrchestration;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const openai_1 = require("@langchain/openai");
const langgraph_1 = require("@langchain/langgraph");
const messages_1 = require("@langchain/core/messages");
const ragRetrieverService_1 = require("./ragRetrieverService");
const rag_1 = require("../config/rag");
// 1. Definição da Ferramenta de Busca (RAG)
const retrieveKnowledgeTool = new tools_1.DynamicStructuredTool({
    name: "retrieve_knowledge",
    description: "Busca informações na base de conhecimento da empresa sobre regras de aluguel, taxas e processos.",
    schema: zod_1.z.object({
        query: zod_1.z.string().describe("A pergunta ou termo de busca para encontrar nos documentos."),
    }),
    func: async ({ query }) => {
        const chunks = await (0, ragRetrieverService_1.retrieveRelevantChunks)(query);
        return chunks.map(c => c.content).join("\n\n---\n\n") || "Nenhuma informação encontrada para esta busca.";
    },
});
const tools = [retrieveKnowledgeTool];
/**
 * Implementação customizada do ToolNode para evitar erros de importação
 */
const customToolNode = async (state) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];
    const toolOutputs = await Promise.all((lastMessage.tool_calls || []).map(async (call) => {
        const tool = tools.find((t) => t.name === call.name);
        if (!tool) {
            return new messages_1.ToolMessage({
                content: `Ferramenta ${call.name} não encontrada.`,
                tool_call_id: call.id || "",
            });
        }
        const output = await tool.invoke(call.args);
        return new messages_1.ToolMessage({
            content: typeof output === 'string' ? output : JSON.stringify(output),
            tool_call_id: call.id || "",
        });
    }));
    return { messages: toolOutputs };
};
// 2. Configuração do Modelo com Tools
const model = new openai_1.ChatOpenAI({
    modelName: rag_1.CHAT_MODEL,
    temperature: 0.2,
    apiKey: process.env.OPENROUTER_API_KEY,
    configuration: {
        baseURL: "https://openrouter.ai/api/v1",
    },
}).bindTools(tools);
// 3. Definição dos Nós do Grafo
const callModel = async (state) => {
    const systemPrompt = new messages_1.SystemMessage("Você é o assistente virtual do I-Moveis. Sua função é ajudar com aluguel de imóveis. " +
        "Use a ferramenta 'retrieve_knowledge' sempre que precisar de informações específicas sobre a empresa. " +
        "Responda sempre em Português do Brasil.");
    const response = await model.invoke([systemPrompt, ...state.messages]);
    return { messages: [response] };
};
const shouldContinue = (state) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "tools";
    }
    return langgraph_1.END;
};
// 4. Construção do Grafo (LangGraph)
const workflow = new langgraph_1.StateGraph(langgraph_1.MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", customToolNode)
    .addEdge(langgraph_1.START, "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");
exports.agentApp = workflow.compile();
/**
 * Função principal para executar a orquestração da IA
 */
async function runAgentOrchestration(sessionId, userMessage, history = []) {
    const inputs = {
        messages: [...history, new messages_1.HumanMessage(userMessage)],
    };
    const result = await exports.agentApp.invoke(inputs);
    const finalMessage = result.messages[result.messages.length - 1];
    return {
        answer: finalMessage.content.toString(),
        // Para compatibilidade com a lógica anterior
        handoff: false,
    };
}
