"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChatModel = getChatModel;
exports.getStructuredChatModel = getStructuredChatModel;
const openai_1 = require("@langchain/openai");
const rag_1 = require("./rag");
function requireEnv(name) {
    const value = process.env[name];
    if (!value || value.trim() === "") {
        throw new Error(`[aiProvider] Missing required environment variable: ${name}`);
    }
    return value;
}
let OPENROUTER_KEY = null;
function getOpenRouterKey() {
    if (OPENROUTER_KEY)
        return OPENROUTER_KEY;
    OPENROUTER_KEY = requireEnv("OPENROUTER_API_KEY");
    const prefix = OPENROUTER_KEY.substring(0, 12);
    console.log(`[aiProvider] OPENROUTER_API_KEY prefix=${prefix} loaded=${!!OPENROUTER_KEY}`);
    return OPENROUTER_KEY;
}
function getChatModel() {
    const apiKey = getOpenRouterKey();
    const llm = new openai_1.ChatOpenAI({
        modelName: rag_1.CHAT_MODEL,
        apiKey,
        configuration: {
            baseURL: "https://openrouter.ai/api/v1",
            apiKey,
        },
        temperature: 0.2,
        maxRetries: 2,
    });
    return {
        invoke: (messages) => llm.invoke(messages),
    };
}
function getStructuredChatModel(schema, name) {
    const apiKey = getOpenRouterKey();
    const llm = new openai_1.ChatOpenAI({
        modelName: rag_1.CHAT_MODEL,
        apiKey,
        configuration: {
            baseURL: "https://openrouter.ai/api/v1",
            apiKey,
        },
        temperature: 0,
        maxRetries: 2,
    });
    const structured = llm.withStructuredOutput(schema, { name });
    return {
        extract: (messages) => structured.invoke(messages),
    };
}
