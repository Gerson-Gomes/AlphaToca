"use strict";
/**
 * LangSmith tracing bootstrap.
 *
 * LangChain auto-enables tracing when `LANGCHAIN_TRACING_V2=true` is set in
 * the environment — no extra wiring is needed. This module exists so the
 * process logs a single unambiguous line at startup telling the operator
 * whether tracing is active and, if so, which project runs will land in.
 *
 * Env vars consumed:
 *   LANGCHAIN_TRACING_V2   — "true" to enable
 *   LANGCHAIN_API_KEY      — required when tracing is enabled
 *   LANGCHAIN_PROJECT      — optional; defaults to "default"
 *   LANGCHAIN_ENDPOINT     — optional; defaults to api.smith.langchain.com
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLangSmithStatus = resolveLangSmithStatus;
exports.bootstrapLangSmith = bootstrapLangSmith;
function resolveLangSmithStatus(env = process.env) {
    const enabled = env.LANGCHAIN_TRACING_V2 === "true";
    const hasKey = typeof env.LANGCHAIN_API_KEY === "string" && env.LANGCHAIN_API_KEY.trim() !== "";
    return {
        enabled,
        project: enabled ? env.LANGCHAIN_PROJECT ?? "default" : null,
        missingApiKey: enabled && !hasKey,
    };
}
function bootstrapLangSmith(logger = console, env = process.env) {
    const status = resolveLangSmithStatus(env);
    if (!status.enabled) {
        logger.log("\x1b[90m[langsmith]\x1b[0m tracing disabled (set LANGCHAIN_TRACING_V2=true + LANGCHAIN_API_KEY to enable)");
        return status;
    }
    if (status.missingApiKey) {
        logger.warn("\x1b[33m[langsmith]\x1b[0m LANGCHAIN_TRACING_V2=true but LANGCHAIN_API_KEY is missing — traces will fail to upload");
        return status;
    }
    logger.log(`\x1b[36m[langsmith]\x1b[0m tracing enabled, project="${status.project}"`);
    return status;
}
