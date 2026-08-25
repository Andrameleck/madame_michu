// Connecteur REST minimal pour les services exposes sous le contrat OpenAI
// Chat Completions + Embeddings. Aucun SDK n'est necessaire dans l'extension.

const OPENAI_COMPATIBLE_TIMEOUT_MS = 120_000;

function openAiCompatibleEndpoints(baseUrl, resource) {
  const base = baseUrl.replace(/\/$/, "");
  if (base.endsWith("/v1")) return [`${base}/${resource}`];
  return [`${base}/${resource}`, `${base}/v1/${resource}`];
}

// Une base sans /v1 est sondee dans les deux formes. Sans memoriser la gagnante,
// chaque appel vers une API OpenAI classique payait un aller-retour 404 avant la
// vraie requete. La forme retenue est simplement essayee en premier : si le
// serveur change de routage, le sondage complet reprend tout seul.
const resolvedOpenAiEndpoints = new Map();

function orderedEndpoints(baseUrl, resource) {
  const endpoints = openAiCompatibleEndpoints(baseUrl, resource);
  const known = resolvedOpenAiEndpoints.get(`${baseUrl}|${resource}`);
  if (!known || endpoints[0] === known) return endpoints;
  return [known, ...endpoints.filter((endpoint) => endpoint !== known)];
}

function rememberEndpoint(baseUrl, resource, endpoint) {
  resolvedOpenAiEndpoints.set(`${baseUrl}|${resource}`, endpoint);
}

async function parseProviderError(response) {
  const payload = await response.json().catch(() => null);
  return payload?.error?.message || payload?.message || `Erreur HTTP ${response.status}`;
}

async function postOpenAiCompatible({ baseUrl, apiKey, resource, payload, timeoutMs }) {
  try {
    return await withAbortTimeout(timeoutMs, async (signal) => {
      const endpoints = orderedEndpoints(baseUrl, resource);
      for (const [index, endpoint] of endpoints.entries()) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          signal,
          body: JSON.stringify(payload),
        });
        // Une base sans /v1 peut etre complete ou pointer vers la racine
        // d'une API compatible OpenAI. Le second chemin couvre ce dernier cas.
        if (response.ok || index === endpoints.length - 1 || ![404, 405].includes(response.status)) {
          if (response.ok) rememberEndpoint(baseUrl, resource, endpoint);
          return response;
        }
      }
      throw new LlmCallError("Aucun endpoint compatible OpenAI disponible.");
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new LlmCallError(`Timeout apres ${timeoutSeconds(timeoutMs)}s.`, { code: "timeout" });
    }
    if (error instanceof LlmCallError) throw error;
    throw new LlmCallError(`Impossible de contacter le provider sur ${baseUrl}.`, {
      cause: error,
      code: "network",
    });
  }
}

async function listOpenAiCompatibleModels({
  baseUrl,
  apiKey,
  timeoutMs = 20_000,
}) {
  let response;
  try {
    response = await withAbortTimeout(timeoutMs, async (signal) => {
      const endpoints = orderedEndpoints(baseUrl, "models");
      let last;
      for (const [index, endpoint] of endpoints.entries()) {
        last = await fetch(endpoint, {
          method: "GET",
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal,
        });
        if (last.ok) {
          rememberEndpoint(baseUrl, "models", endpoint);
          break;
        }
        if (index === endpoints.length - 1 || ![404, 405].includes(last.status)) break;
      }
      return last;
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new LlmCallError(`Timeout apres ${timeoutSeconds(timeoutMs)}s.`, {
        code: "timeout",
      });
    }
    throw new LlmCallError(`Impossible de contacter le provider sur ${baseUrl}.`, {
      cause: error,
      code: "network",
    });
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
