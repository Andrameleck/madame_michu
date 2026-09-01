// Adaptateur Ollama (modele local). Proche du dialecte OpenAI mais avec trois
// differences qui justifient un adaptateur distinct : les arguments d'outil
// arrivent deja parses, le JSON strict passe par `format`, et les reponses
// d'outil n'ont pas d'identifiant a renvoyer.

import { ProviderError } from "../../core/errors.js";
import { joinUrl, requestJson } from "../transport.js";

function toWireMessages(messages) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return { role: "tool", content: message.content, ...(message.name ? { tool_name: message.name } : {}) };
    }
    if (message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || "",
        tool_calls: message.toolCalls.map((call) => ({
          function: { name: call.name, arguments: call.arguments ?? {} },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

export const ollamaAdapter = {
  async chat(context, request) {
    const data = await requestJson(joinUrl(context.baseUrl, "api/chat"), {
      body: {
        model: context.model,
        messages: toWireMessages(request.messages),
        stream: false,
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }
          : {}),
        ...(request.responseSchema ? { format: request.responseSchema } : {}),
        options: {
          ...(request.temperature != null ? { temperature: request.temperature } : {}),
          ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
        },
      },
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      label: context.label,
      describeError: (payload, status) => {
        if (status === 404) {
          return `le modele « ${context.model} » est absent. Lance \`ollama pull ${context.model}\`.`;
        }
        return undefined;
      },
    });

    const message = data?.message;
    if (!message) {
      throw new ProviderError(`${context.label} a renvoye une reponse sans message.`, {
        code: "invalid_response",
      });
    }
    const toolCalls = (message.tool_calls || [])
      .filter((call) => call?.function?.name)
      .map((call, index) => ({
        id: `call_${index}`,
        name: call.function.name,
        arguments: typeof call.function.arguments === "string"
          ? safeParse(call.function.arguments)
          : call.function.arguments ?? {},
      }));
    return {
      text: message.content || "",
      toolCalls,
      finishReason: toolCalls.length ? "tool_calls" : data.done_reason === "length" ? "length" : "stop",
      usage: { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count },
      model: data.model || context.model,
    };
  },

  async listModels(context) {
    const data = await requestJson(joinUrl(context.baseUrl, "api/tags"), {
      method: "GET",
      timeoutMs: 20_000,
      label: context.label,
    });
    const list = Array.isArray(data?.models) ? data.models : [];
    return list.map((item) => item?.model || item?.name).filter((name) => typeof name === "string");
  },
};

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
