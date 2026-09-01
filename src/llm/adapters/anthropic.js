// Adaptateur Anthropic Messages. Trois ecarts structurants avec le dialecte
// OpenAI, qui expliquent la traduction ci-dessous :
//   - le prompt systeme est un champ de premier niveau, pas un message ;
//   - les appels et resultats d'outil sont des blocs de contenu, et un resultat
//     d'outil voyage dans un message "user" ;
//   - il n'existe pas de mode JSON : on force un outil dont le schema est le
//     contrat attendu, ce qui donne un JSON valide par construction.

import { ProviderError } from "../../core/errors.js";
import { joinUrl, requestJson } from "../transport.js";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;
const JSON_TOOL_NAME = "reponse_structuree";

function headers(context) {
  return {
    "x-api-key": context.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    // Sans cet en-tete l'API refuse toute requete emise depuis un contexte
    // navigateur, ce qu'est une MailExtension.
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

function splitSystem(messages) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return { system, rest: messages.filter((message) => message.role !== "system") };
}

function toWireMessages(messages) {
  const wire = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content || "",
      };
      // Anthropic exige que des resultats consecutifs soient regroupes dans un
      // seul message utilisateur, sinon la conversation est rejetee.
      const last = wire[wire.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") {
        last.content.push(block);
      } else {
        wire.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (message.toolCalls?.length) {
      wire.push({
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text", text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments ?? {},
          })),
        ],
      });
      continue;
    }
    wire.push({ role: message.role, content: message.content });
  }
  return wire;
}

export const anthropicAdapter = {
  async chat(context, request) {
    const { system, rest } = splitSystem(request.messages);
    const jsonMode = Boolean(request.responseSchema);
    const tools = jsonMode
      ? [{
          name: JSON_TOOL_NAME,
          description: "Renvoie la reponse au format demande.",
          input_schema: request.responseSchema,
        }]
      : (request.tools || []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        }));

    const data = await requestJson(joinUrl(context.baseUrl, "v1/messages"), {
      headers: headers(context),
      body: {
        model: context.model,
        max_tokens: request.maxTokens || DEFAULT_MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: toWireMessages(rest),
        ...(tools.length ? { tools } : {}),
        ...(jsonMode ? { tool_choice: { type: "tool", name: JSON_TOOL_NAME } } : {}),
        ...(!jsonMode && tools.length && request.toolChoice === "required"
          ? { tool_choice: { type: "any" } }
          : {}),
        ...(request.temperature != null ? { temperature: request.temperature } : {}),
      },
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      label: context.label,
    });

    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
    const uses = blocks.filter((block) => block.type === "tool_use");

    if (jsonMode) {
      const structured = uses.find((block) => block.name === JSON_TOOL_NAME);
      if (!structured) {
        throw new ProviderError(`${context.label} n'a pas renvoye la reponse structuree demandee.`, {
          code: "invalid_response",
        });
      }
      return {
        text: JSON.stringify(structured.input),
        toolCalls: [],
        finishReason: "stop",
        usage: usageOf(data),
        model: data.model || context.model,
      };
    }

    return {
      text,
      toolCalls: uses.map((block) => ({ id: block.id, name: block.name, arguments: block.input ?? {} })),
      finishReason: data.stop_reason === "tool_use"
        ? "tool_calls"
        : data.stop_reason === "max_tokens"
          ? "length"
          : "stop",
      usage: usageOf(data),
      model: data.model || context.model,
    };
  },

  async listModels(context) {
    const data = await requestJson(joinUrl(context.baseUrl, "v1/models?limit=100"), {
      method: "GET",
      headers: headers(context),
      timeoutMs: 20_000,
      label: context.label,
    });
    const list = Array.isArray(data?.data) ? data.data : [];
    return list.map((item) => item?.id).filter((id) => typeof id === "string");
  },
};

function usageOf(data) {
  return { inputTokens: data?.usage?.input_tokens, outputTokens: data?.usage?.output_tokens };
}
