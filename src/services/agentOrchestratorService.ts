import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END, MessagesAnnotation } from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { retrieveRelevantChunks } from "./ragRetrieverService";
import { CHAT_MODEL } from "../config/rag";

// 1. Definição da Ferramenta de Busca (RAG)
const retrieveKnowledgeTool = new DynamicStructuredTool({
  name: "retrieve_knowledge",
  description: "Busca informações na base de conhecimento da empresa sobre regras de aluguel, taxas e processos.",
  schema: z.object({
    query: z.string().describe("A pergunta ou termo de busca para encontrar nos documentos."),
  }),
  func: async ({ query }) => {
    const chunks = await retrieveRelevantChunks(query);
    return chunks.map(c => c.content).join("\n\n---\n\n") || "Nenhuma informação encontrada para esta busca.";
  },
});

const tools = [retrieveKnowledgeTool];

/**
 * Implementação customizada do ToolNode para evitar erros de importação
 */
const customToolNode = async (state: typeof MessagesAnnotation.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  
  const toolOutputs = await Promise.all(
    (lastMessage.tool_calls || []).map(async (call) => {
      const tool = tools.find((t) => t.name === call.name);
      if (!tool) {
        return new ToolMessage({
          content: `Ferramenta ${call.name} não encontrada.`,
          tool_call_id: call.id || "",
        });
      }
      const output = await tool.invoke(call.args as any);
      return new ToolMessage({
        content: typeof output === 'string' ? output : JSON.stringify(output),
        tool_call_id: call.id || "",
      });
    })
  );
  
  return { messages: toolOutputs };
};

// 2. Configuração do Modelo com Tools
const model = new ChatOpenAI({
  modelName: CHAT_MODEL,
  temperature: 0.2,
  apiKey: process.env.OPENROUTER_API_KEY,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
}).bindTools(tools);

// 3. Definição dos Nós do Grafo
const callModel = async (state: typeof MessagesAnnotation.State) => {
  const systemPrompt = new SystemMessage(
    "Você é o assistente virtual do I-Moveis. Sua função é ajudar com aluguel de imóveis. " +
    "Use a ferramenta 'retrieve_knowledge' sempre que precisar de informações específicas sobre a empresa. " +
    "Responda sempre em Português do Brasil."
  );
  
  const response = await model.invoke([systemPrompt, ...state.messages]);
  return { messages: [response] };
};

const shouldContinue = (state: typeof MessagesAnnotation.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  return END;
};

// 4. Construção do Grafo (LangGraph)
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", customToolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");

export const agentApp = workflow.compile();

/**
 * Função principal para executar a orquestração da IA
 */
export async function runAgentOrchestration(sessionId: string, userMessage: string, history: BaseMessage[] = []) {
  const inputs = {
    messages: [...history, new HumanMessage(userMessage)],
  };
  
  const result = await agentApp.invoke(inputs);
  const finalMessage = result.messages[result.messages.length - 1];
  
  return {
    answer: finalMessage.content.toString(),
    // Para compatibilidade com a lógica anterior
    handoff: false, 
  };
}
