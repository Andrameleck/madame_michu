// Adaptateur OpenAI et compatibles (OpenAI, Groq, Mistral, OpenRouter, LM Studio,
// vLLM...). C'est le dialecte le plus repandu : tout service qui expose
// /chat/completions passe par ici, seule l'URL de base change.

import { ProviderError } from "../../core/errors.js";
import { joinUrl, requestJson } from "../transport.js";

function toWireMessages(messages) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toWireTools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

// Les arguments arrivent en chaine JSON. Un modele qui produit du JSON casse est
// une erreur reessayable : le profil suivant, ou une nouvelle tentative, peut aboutir.
function parseArguments(raw, toolName) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ProviderError(
      `Le modele a produit des arguments illisibles pour l'outil « ${toolName} ».`,
      { code: "invalid_response", cause: error }
    );
  }
}

const FINISH_REASONS = { stop: "stop", tool_calls: "tool_calls", length: "length" };

export const openAiAdapter = {
  async chat(context, request) {
    const payload = {
      model: context.model,
      messages: toWireMessages(request.messages),
      ...(request.tools?.length ? { tools: toWireTools(request.tools) } : {}),
      ...(request.tools?.length && request.toolChoice ? { tool_choice: request.toolChoice } : {}),
      ...(request.responseSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "reponse", schema: request.responseSchema, strict: false },
            },
          }
        : {}),
      ...(request.temperature != null ? { temperature: request.temperature } : {}),
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      stream: false,
    };

    const data = await requestJson(joinUrl(context.baseUrl, "chat/completions"), {
      headers: context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : {},
      body: payload,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      label: context.label,
    });

    const choice = data?.choices?.[0];
    if (!choice) {
      throw new ProviderError(`${context.label} a renvoye une reponse sans contenu.`, {
        code: "invalid_response",
      });
    }
    const toolCalls = (choice.message?.tool_calls || [])
      .filter((call) => call?.function?.name)
      .map((call, index) => ({
        id: call.id || `call_${index}`,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments, call.function.name),
      }));
    return {
      text: choice.message?.content || "",
      toolCalls,
      finishReason: FINISH_REASONS[choice.finish_reason] || (toolCalls.length ? "tool_calls" : "unknown"),
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
      model: data.model || context.model,
    };
  },

  async listModels(context) {
    const data = await requestJson(joinUrl(context.baseUrl, "models"), {
      method: "GET",
      headers: context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : {},
      timeoutMs: 20_000,
      label: context.label,
    });
    const list = Array.isArray(data?.data) ? data.data : [];
    return list.map((item) => item?.id).filter((id) => typeof id === "string");
  },
};
