// Connecteur REST minimal pour les services exposes sous le contrat OpenAI
// Chat Completions + Embeddings. Aucun SDK n'est necessaire dans l'extension.

const OPENAI_COMPATIBLE_TIMEOUT_MS = 120_000;

function openAiCompatibleEndpoints(baseUrl, resource) {
  const base = baseUrl.replace(/\/$/, "");
  if (base.endsWith("/v1")) return [`${base}/${resource}`];
  return [`${base}/${resource}`, `${base}/v1/${resource}`];
}

async function parseProviderError(response) {
  const payload = await response.json().catch(() => null);
  return payload?.error?.message || payload?.message || `Erreur HTTP ${response.status}`;
}

async function postOpenAiCompatible({ baseUrl, apiKey, resource, payload, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoints = openAiCompatibleEndpoints(baseUrl, resource);
    for (const [index, endpoint] of endpoints.entries()) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      if (response.ok || index === endpoints.length - 1) return response;
      // Une base sans /v1 peut etre soit complete (Argo), soit pointer vers
      // la racine d'une API OpenAI. Le second chemin couvre ce dernier cas.
      if (![404, 405].includes(response.status)) return response;
    }
    throw new Error("Aucun endpoint compatible OpenAI disponible.");
  } catch (error) {
    if (error.name === "AbortError") {
      throw new LlmCallError(`Timeout apres ${Math.round(timeoutMs / 1000)}s.`, {
        code: "timeout",
      });
    }
    throw new LlmCallError(`Impossible de contacter le provider sur ${baseUrl}.`, {
      cause: error,
      code: "network",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function listOpenAiCompatibleModels({
  baseUrl,
  apiKey,
  timeoutMs = 20_000,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    const endpoints = openAiCompatibleEndpoints(baseUrl, "models");
    for (const [index, endpoint] of endpoints.entries()) {
      response = await fetch(endpoint, {
        method: "GET",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: controller.signal,
      });
      if (response.ok || index === endpoints.length - 1) break;
      if (![404, 405].includes(response.status)) break;
    }
  } catch (error) {
    if (error.name === "AbortError") {
      throw new LlmCallError(`Timeout apres ${Math.round(timeoutMs / 1000)}s.`, {
        code: "timeout",
      });
    }
    throw new LlmCallError(`Impossible de contacter le provider sur ${baseUrl}.`, {
      cause: error,
      code: "network",
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await parseProviderError(response);
    if (response.status === 401 || response.status === 403) {
      throw new LlmCallError(`Authentification refusee par le provider : ${detail}`, {
        code: "auth",
      });
    }
    throw new LlmCallError(`Impossible de lister les modeles (${response.status}) : ${detail}`);
  }

  const data = await response.json().catch((error) => {
    throw new LlmCallError("Reponse non-JSON lors de la lecture des modeles.", {
      cause: error,
      code: "invalid_response",
    });
  });
  if (!Array.isArray(data?.data)) {
    throw new LlmCallError("La reponse /v1/models ne contient pas de liste exploitable.", {
      code: "invalid_response",
    });
  }
  return data.data
    .map((model) => model?.id)
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim());
}

async function callOpenAiCompatibleChat({
  baseUrl,
  apiKey,
  model,
  messages,
  jsonMode = false,
  timeoutMs = OPENAI_COMPATIBLE_TIMEOUT_MS,
}) {
  const payload = { model, messages, stream: false };
  if (jsonMode) payload.response_format = { type: "json_object" };

  let response = await postOpenAiCompatible({
    baseUrl,
    apiKey,
    resource: "chat/completions",
    payload,
    timeoutMs,
  });

  // Certains serveurs se disent compatibles mais ignorent response_format.
  // Un seul repli sans ce champ preserve leur utilisation sans masquer les
  // autres erreurs de configuration.
  if (jsonMode && response.status === 400) {
    delete payload.response_format;
    response = await postOpenAiCompatible({
      baseUrl,
      apiKey,
      resource: "chat/completions",
      payload,
      timeoutMs,
    });
  }

  if (!response.ok) {
    const detail = await parseProviderError(response);
    if (response.status === 401 || response.status === 403) {
      throw new LlmCallError(`Authentification refusee par le provider : ${detail}`, {
        code: "auth",
      });
    }
    if (response.status === 429) {
      throw new LlmCallError(`Limite de requetes atteinte : ${detail}`, { code: "rate_limit" });
    }
    throw new LlmCallError(`Le provider a repondu ${response.status} : ${detail}`);
  }

  const data = await response.json().catch((error) => {
    throw new LlmCallError("Reponse non-JSON du provider compatible OpenAI.", { cause: error });
  });
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new LlmCallError("Reponse du provider sans contenu exploitable.");
  }
  return content;
}

async function callOpenAiCompatibleEmbedding({
  baseUrl,
  apiKey,
  model,
  text,
  timeoutMs = 60_000,
}) {
  const response = await postOpenAiCompatible({
    baseUrl,
    apiKey,
    resource: "embeddings",
    payload: { model, input: text },
    timeoutMs,
  });
  if (!response.ok) {
    throw new LlmCallError(
      `Echec embeddings (${response.status}) : ${await parseProviderError(response)}`
    );
  }
  const data = await response.json().catch((error) => {
    throw new LlmCallError("Reponse embeddings non-JSON.", { cause: error });
  });
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new LlmCallError("Reponse embeddings sans vecteur exploitable.");
  }
  return embedding;
}
