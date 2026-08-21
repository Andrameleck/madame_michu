// Connecteur REST Anthropic Messages. Anthropic ne propose pas d'endpoint
// d'embeddings : les profils de ce type servent uniquement au chat et aux resumes.

const ANTHROPIC_TIMEOUT_MS = 120_000;
const ANTHROPIC_VERSION = "2023-06-01";

function anthropicEndpoint(baseUrl, resource) {
  const base = baseUrl.replace(/\/$/, "");
  return `${base.endsWith("/v1") ? base : `${base}/v1`}/${resource}`;
}

function anthropicHeaders(apiKey, includeContentType = false) {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    ...(includeContentType ? { "Content-Type": "application/json" } : {}),
  };
}

async function parseAnthropicError(response) {
  const payload = await response.json().catch(() => null);
  return payload?.error?.message || `Erreur HTTP ${response.status}`;
}

async function fetchAnthropic(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new LlmCallError(`Timeout apres ${Math.round(timeoutMs / 1000)}s.`, {
        code: "timeout",
      });
    }
    throw new LlmCallError("Impossible de contacter Anthropic.", {
      cause: error,
      code: "network",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function splitAnthropicMessages(messages) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversation = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: String(message.content || "") }));
  return { system, conversation };
}

async function callAnthropicChat({
  baseUrl,
  apiKey,
  model,
  messages,
  timeoutMs = ANTHROPIC_TIMEOUT_MS,
}) {
  if (!apiKey) {
    throw new LlmCallError("La cle API Anthropic est obligatoire.", { code: "configuration" });
  }
  const { system, conversation } = splitAnthropicMessages(messages);
  const response = await fetchAnthropic(
    anthropicEndpoint(baseUrl, "messages"),
    {
      method: "POST",
      headers: anthropicHeaders(apiKey, true),
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages: conversation,
      }),
    },
    timeoutMs
  );

  if (!response.ok) {
    const detail = await parseAnthropicError(response);
    if (response.status === 401 || response.status === 403) {
      throw new LlmCallError(`Authentification refusee par Anthropic : ${detail}`, {
        code: "auth",
      });
    }
    if (response.status === 429) {
      throw new LlmCallError(`Limite de requetes Anthropic atteinte : ${detail}`, {
        code: "rate_limit",
      });
    }
    throw new LlmCallError(`Anthropic a repondu ${response.status} : ${detail}`);
  }

  const data = await response.json().catch((error) => {
    throw new LlmCallError("Reponse Anthropic non-JSON.", {
      cause: error,
      code: "invalid_response",
    });
  });
  const content = Array.isArray(data?.content)
    ? data.content
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim()
    : "";
  if (!content) throw new LlmCallError("Reponse Anthropic sans contenu exploitable.");
  return content;
}

async function listAnthropicModels({ baseUrl, apiKey, timeoutMs = 20_000 }) {
  if (!apiKey) {
    throw new LlmCallError("La cle API Anthropic est obligatoire.", { code: "configuration" });
  }
  const response = await fetchAnthropic(
    anthropicEndpoint(baseUrl, "models"),
    { method: "GET", headers: anthropicHeaders(apiKey) },
    timeoutMs
  );
  if (!response.ok) {
    const detail = await parseAnthropicError(response);
    if (response.status === 401 || response.status === 403) {
      throw new LlmCallError(`Authentification refusee par Anthropic : ${detail}`, {
        code: "auth",
      });
    }
    throw new LlmCallError(`Impossible de lister les modeles Anthropic : ${detail}`);
  }
  const data = await response.json().catch((error) => {
    throw new LlmCallError("Reponse Anthropic non-JSON lors de la lecture des modeles.", {
      cause: error,
      code: "invalid_response",
    });
  });
  if (!Array.isArray(data?.data)) {
    throw new LlmCallError("Anthropic n'a retourne aucune liste de modeles exploitable.", {
      code: "invalid_response",
    });
  }
  return data.data
    .map((model) => model?.id)
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim());
}
