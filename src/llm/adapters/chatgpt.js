// Adaptateur « abonnement ChatGPT » : il consomme le backend Responses inclus
// dans un compte Plus/Pro/Team via OAuth, sans cle API. Deux particularites :
// la reponse arrive toujours en flux SSE, et l'historique doit distinguer les
// entrees de l'utilisateur des sorties du modele reinjectees.

import { ProviderError } from "../../core/errors.js";
import { requestRaw, statusToErrorCode } from "../transport.js";
import { ensureAccessToken } from "../auth/chatgptOAuth.js";

const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

// Le backend n'expose pas d'endpoint de listing : cette liste alimente le
// selecteur de la page d'options et n'a aucun effet sur les appels.
export const CHATGPT_MODELS = Object.freeze([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
]);

function toWireInput(messages) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => String(message.content || ""))
    .join("\n\n");

  const input = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: String(message.content || ""),
      });
      continue;
    }
    if (message.toolCalls?.length) {
      if (message.content) {
        input.push({ role: "assistant", content: [{ type: "output_text", text: message.content }] });
      }
      for (const call of message.toolCalls) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        });
      }
      continue;
    }
    input.push({
      role: message.role,
      // Reinjecter une sortie du modele etiquetee `input_text` fait echouer la
      // requete avec un HTTP 400 : le type depend du role.
      content: [{
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: String(message.content || ""),
      }],
    });
  }
  return { instructions, input };
}

/** Reassemble le texte et les appels d'outil d'un flux SSE Responses. */
export function parseResponseStream(rawBody) {
  const raw = String(rawBody || "").trim();
  if (!raw) return { text: "", toolCalls: [], finishReason: "unknown" };

  // Compatibilite avec une reponse JSON non streamee.
  if (raw.startsWith("{")) {
    try {
      return fromCompletedResponse(JSON.parse(raw), "");
    } catch {
      return { text: "", toolCalls: [], finishReason: "unknown" };
    }
  }

  let text = "";
  let completed = null;
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const payload = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!payload || payload === "[DONE]") continue;

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      text += event.delta;
    } else if (event.type === "response.output_text.done" && !text && typeof event.text === "string") {
      text = event.text;
    } else if (event.type === "response.completed") {
      completed = event.response;
    } else if (event.type === "response.failed" || event.type === "error") {
      const detail = event.response?.error?.message || event.error?.message || event.message;
      throw new ProviderError(`Le flux ChatGPT a ete interrompu${detail ? ` : ${detail}` : "."}`, {
        code: "server",
      });
    }
  }
  return fromCompletedResponse(completed, text.trim());
}

function fromCompletedResponse(response, streamedText) {
  const output = Array.isArray(response?.output) ? response.output : [];
  const toolCalls = output
    .filter((item) => item?.type === "function_call" && item.name)
    .map((item, index) => ({
      id: item.call_id || item.id || `call_${index}`,
      name: item.name,
      arguments: safeParse(item.arguments),
    }));
  const text = streamedText
    || (typeof response?.output_text === "string" ? response.output_text.trim() : "")
    || output
      .filter((item) => item?.type === "message" && Array.isArray(item.content))
      .flatMap((item) => item.content)
      .filter((content) => content?.type === "output_text" && typeof content.text === "string")
      .map((content) => content.text)
      .join("\n")
      .trim();
  return {
    text,
    toolCalls,
    finishReason: toolCalls.length
      ? "tool_calls"
      : response?.status === "incomplete"
        ? "length"
        : "stop",
  };
}

/**
 * Resume les types d'evenements recus. Sans cela, un flux qu'on ne sait pas lire
 * se presente comme une reponse vide, et il n'y a rien a quoi se raccrocher.
 */
function describeStream(rawBody) {
  const raw = String(rawBody || "").trim();
  if (!raw) return "Le service n'a rien envoye du tout.";
  const types = new Set();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload);
      if (event.type) types.add(event.type);
    } catch {
      // Ligne non-JSON : sans interet pour le diagnostic.
    }
  }
  return types.size
    ? `Evenements recus : ${[...types].slice(0, 8).join(", ")}.`
    : `Debut de la reponse : ${raw.slice(0, 120)}`;
}

function safeParse(value) {
  if (value == null) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function post(context, credentials, request) {
  const { instructions, input } = toWireInput(request.messages);
  return requestRaw(RESPONSES_URL, {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${credentials.accessToken}`,
      // Valeur reprise telle quelle de la version 1 : le backend Codex la
      // reconnait. Ne pas la « moderniser » sans l'avoir verifiee en vrai.
      originator: "assistant-mail-ia",
      session_id: crypto.randomUUID(),
      ...(credentials.accountId ? { "ChatGPT-Account-Id": credentials.accountId } : {}),
    },
    body: {
      model: context.model,
      input,
      ...(instructions ? { instructions } : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          }
        : {}),
      ...(request.tools?.length && request.toolChoice === "required" ? { tool_choice: "required" } : {}),
      reasoning: { effort: context.options?.reasoningEffort || "low" },
      stream: true,
      store: false,
    },
    timeoutMs: request.timeoutMs,
    signal: request.signal,
    label: context.label,
  });
}

export const chatgptAdapter = {
  async chat(context, request) {
    let credentials = await ensureAccessToken(context);
    let response = await post(context, credentials, request);
    if (response.status === 401) {
      // Le jeton peut avoir ete revoque avant son echeance : une seule seconde
      // chance, avec un rafraichissement force.
      credentials = await ensureAccessToken(context, { force: true });
      response = await post(context, credentials, request);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new ProviderError(`${context.label} a refuse la requete : ${detail || response.status}`, {
        code: statusToErrorCode(response.status),
        details: { status: response.status },
      });
    }

    // `.catch(() => "")` ici masquerait une coupure en cours de lecture (page
    // d'arriere-plan suspendue, connexion perdue) derriere le meme message
    // qu'une reponse authentiquement vide : deux causes tres differentes qui
    // appellent des reactions differentes (reessayer vs. changer de profil).
    let body;
    try {
      body = await response.text();
    } catch (error) {
      throw new ProviderError(
        `${context.label} a interrompu sa reponse avant la fin`
          + `${error?.message ? ` (${error.message})` : "."}`,
        { code: "network", cause: error }
      );
    }
    const parsed = parseResponseStream(body);
    if (!parsed.text && !parsed.toolCalls.length) {
      // Une reponse vide alors qu'on demandait des outils est le symptome d'un
      // backend qui ne les accepte pas : on la signale comme telle pour que la
      // gateway retente ce meme profil en protocole emule.
      if (request.tools?.length) {
        throw new ProviderError(
          `${context.label} n'a rien renvoye quand des outils lui sont proposes.`,
          { code: "unsupported" }
        );
      }
      throw new ProviderError(
        `${context.label} a renvoye une reponse vide (HTTP ${response.status}). ${describeStream(body)}`,
        { code: "invalid_response" }
      );
    }
    return { ...parsed, usage: {}, model: context.model };
  },

  async listModels() {
    return [...CHATGPT_MODELS];
  },
};
