import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";

import {
  getStructuredChatModel,
  type StructuredLLM,
} from "../config/aiProvider";

export const SEARCH_INTENT_VALUES = ["search", "other"] as const;
export type SearchIntent = (typeof SEARCH_INTENT_VALUES)[number];

const BR_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

export const SearchFiltersSchema = z.object({
  intent: z.enum(SEARCH_INTENT_VALUES),
  city: z.string().nullable(),
  state: z
    .string()
    .transform((s) => {
      const trimmed = s.trim().replace(/[^a-zA-Z]/g, "");
      return trimmed.length >= 2 ? trimmed.slice(0, 2).toUpperCase() : trimmed.toUpperCase();
    })
    .refine((s) => !s ||  BR_STATES.has(s), { message: "Estado brasileiro invalido" })
    .nullable(),
  maxPrice: z
    .coerce.number()
    .positive()
    .nullable(),
});

export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export type { StructuredLLM };

const SYSTEM_PROMPT = [
  "Você é um extrator de parâmetros de busca imobiliária do I-Móveis (aluguel de imóveis no Brasil).",
  "",
  "Sua função é ler a mensagem do inquilino e extrair, quando presentes, os seguintes filtros:",
  "- intent: \"search\" se o usuário está procurando imóveis com filtros de cidade/estado E orçamento máximo. \"other\" caso contrário (ex: perguntas gerais, saudações, pedido de visita, dúvida sobre contrato).",
  "- city: nome da cidade mencionada (ex: \"São Paulo\", \"Rio de Janeiro\", \"Belo Horizonte\"). null se não mencionada.",
  "- state: sigla de 2 letras do estado (ex: \"SP\", \"RJ\", \"MG\"). null se não mencionada.",
  "- maxPrice: valor máximo de aluguel em reais, apenas o número (ex: 1500 para \"R$ 1.500\" ou \"até 1500\"). null se não mencionado.",
  "",
  "Regras IMPORTANTES:",
  "- \"Centro\" sozinho NÃO é city — é um bairro. city deve ser o nome completo de uma cidade.",
  "- Se o usuário disser \"Rio de Janeiro\", extraia city=\"Rio de Janeiro\" e state=\"RJ\".",
  "- Se disser apenas a sigla do estado (ex: \"RJ\", \"SP\"), extraia city=null e state=\"RJ\" ou \"SP\".",
  "- Se o usuário disser \"São Paulo\", extraia city=\"São Paulo\" e state=\"SP\".",
  "- maxPrice deve ser o valor NUMÉRICO, sem símbolos ou texto (ex: \"R$ 2.500\" → maxPrice=2500).",
  "- Só retorne intent=\"search\" quando houver PELO MENOS uma cidade OU estado E um orçamento máximo.",
  "- Se não houver informação suficiente para uma busca estruturada, retorne intent=\"other\" com os demais campos como null.",
  "- NÃO invente dados. Se uma informação não está na mensagem, retorne null.",
  "- Responda APENAS no formato estruturado solicitado.",
].join("\n");

export function buildSearchExtractionMessages(
  userMessage: string,
): BaseMessage[] {
  return [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(userMessage)];
}

let defaultExtractorCache: StructuredLLM<SearchFilters> | null = null;

function getDefaultExtractor(): StructuredLLM<SearchFilters> {
  if (defaultExtractorCache) return defaultExtractorCache;
  defaultExtractorCache = getStructuredChatModel(
    SearchFiltersSchema,
    "extract_search_filters",
  );
  return defaultExtractorCache;
}

export async function extractSearchFilters(
  userMessage: string,
): Promise<SearchFilters> {
  const extractor = getDefaultExtractor();
  const messages = buildSearchExtractionMessages(userMessage);
  const parsed = await extractor.extract(messages);
  return SearchFiltersSchema.parse(parsed);
}

export function buildSearchResponse(params: {
  total: number;
  city: string | null;
  state: string | null;
  maxPrice: number;
  appBaseUrl: string;
}): string {
  const { total, city, state, maxPrice, appBaseUrl } = params;
  const location = city ? `${city}/${state}` : state!;

  const searchParams = new URLSearchParams();
  if (state) searchParams.set("state", state);
  if (city) searchParams.set("city", city);
  searchParams.set("maxPrice", String(maxPrice));
  const deepLink = `${appBaseUrl}/search?${searchParams.toString()}`;

  const formattedPrice = maxPrice.toLocaleString("pt-BR");

  if (total === 0) {
    return [
      `Infelizmente não encontrei imóveis em ${location} até R$ ${formattedPrice} no momento. \u{1F615}`,
      "",
      "Que tal ajustar o orçamento ou buscar em outra região?",
    ].join("\n");
  }

  return [
    `Encontrei ${total} imóveis em ${location} que cabem no seu orçamento de até R$ ${formattedPrice}. \u{1F3AF}`,
    "",
    "Veja as fotos, detalhes completos e filtre como quiser:",
    `\u{1F449} ${deepLink}`,
  ].join("\n");
}
