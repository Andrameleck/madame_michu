// Aiguillage commun et repli ordonne entre plusieurs profils LLM.

const PROVIDER_CHAT_TIMEOUT_MS = 30_000;
const PROVIDER_SUMMARY_TIMEOUT_MS = 75_000;

function legacyProviderProfile(settings) {
  return {
    id: "legacy-primary",
    name: "Provider principal",
    enabled: true,
    type: settings.llmProvider,
    baseUrl: settings.providerBaseUrl,
    model: settings.providerModel,
    apiKey: settings.apiKey || "",
    embeddingModel: settings.embeddingModel || "",
  };
}

function getEnabledProviderProfiles(settings) {
  const profiles = Array.isArray(settings.llmProfiles) && settings.llmProfiles.length
    ? settings.llmProfiles
    : [legacyProviderProfile(settings)];
  const enabled = profiles.filter((profile) => profile?.enabled !== false);
  const preferredIndex = enabled.findIndex((profile) => profile.id === settings.preferredProviderId);
  if (preferredIndex <= 0) return enabled;
  return [enabled[preferredIndex], ...enabled.slice(0, preferredIndex), ...enabled.slice(preferredIndex + 1)];
}

function normalizeProviderProfile(profile) {
  return {
    ...profile,
    type: profile.type || profile.llmProvider,
    baseUrl: profile.baseUrl || profile.providerBaseUrl,
    model: profile.model || profile.providerModel,
    apiKey: profile.apiKey || "",
    embeddingModel: profile.embeddingModel || "",
  };
}

function assertConfiguredProfile(profile) {
  if ((!profile.baseUrl && profile.type !== "openai-codex") || !profile.model) {
    throw new LlmCallError(`Le profil « ${profile.name || "sans nom"} » est incomplet.`, {
      code: "configuration",
    });
  }
  if (profile.type === "anthropic" && !profile.apiKey) {
    throw new LlmCallError(`Le profil « ${profile.name || "Anthropic"} » exige une cle API.`, {
      code: "configuration",
    });
  }
}

function sanitizeProviderMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) =>
      ["system", "user", "assistant"].includes(message?.role) &&
      typeof message.content === "string"
    )
    .map((message) => ({ role: message.role, content: message.content }));
}

async function callSingleProviderChat(profile, messages, { timeoutMs, jsonMode = false } = {}) {
  profile = normalizeProviderProfile(profile);
  assertConfiguredProfile(profile);
  messages = sanitizeProviderMessages(messages);
  if (profile.type === "ollama") {
    return callOllamaChat({
      baseUrl: profile.baseUrl,
      model: profile.model,
      messages,
      ...(jsonMode ? { format: SUMMARY_RESPONSE_SCHEMA } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  }
  if (profile.type === "openai-compatible") {
    return callOpenAiCompatibleChat({
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      messages,
      jsonMode,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  }
  if (profile.type === "anthropic") {
    return callAnthropicChat({
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      messages,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  }
  if (profile.type === "openai-codex") {
    return callOpenAiCodexChat({
      profile,
      messages,
      reasoningEffort: "low",
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  }
  throw new LlmCallError(`Provider inconnu : ${profile.type}`, { code: "configuration" });
}

async function callWithProviderFallback(settings, operation) {
  const profiles = getEnabledProviderProfiles(settings).map(normalizeProviderProfile);
  if (!profiles.length) {
    throw new LlmCallError("Aucun profil LLM actif n'est configure.", { code: "configuration" });
  }
  const failures = [];
  for (const profile of profiles) {
    try {
      return await operation(profile);
    } catch (error) {
      failures.push(`${profile.name || profile.type}: ${error.message || "echec inconnu"}`);
      if (typeof logger !== "undefined") {
        logger.warn("Echec du profil LLM, tentative du suivant", {
          profile: profile.name || profile.type,
          category: error.code || "provider",
        });
      }
    }
  }
  const failureSummary = profiles.length === 1
    ? `Le seul profil LLM actif a echoue. ${failures[0]} Aucun profil de secours actif n'est configure.`
    : `Tous les profils LLM ont echoue. ${failures.join(" | ")}`;
  throw new LlmCallError(failureSummary, {
    code: "all_providers_failed",
  });
}

async function callProviderSummary(settings, system, user) {
  return callWithProviderFallback(settings, async (profile) => {
    const raw = await callSingleProviderChat(
      profile,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { jsonMode: true, timeoutMs: PROVIDER_SUMMARY_TIMEOUT_MS }
    );
    // Une reponse HTTP 200 mais inexploitable n'est pas un succes : le profil
    // suivant doit avoir sa chance, comme pour un timeout ou une erreur HTTP.
    parseLlmResponse(raw);
    return raw;
  });
}

async function callProviderChat(settings, messages, { timeoutMs } = {}) {
  return callWithProviderFallback(settings, (profile) =>
    callSingleProviderChat(profile, messages, {
      timeoutMs: timeoutMs || PROVIDER_CHAT_TIMEOUT_MS,
    })
  );
}

async function testProviderConnection(settings) {
  const profile = normalizeProviderProfile(settings);
  const startedAt = Date.now();
  try {
    await callSingleProviderChat(
      profile,
      [{ role: "user", content: "Reponds uniquement par OK." }],
      { timeoutMs: 20_000 }
    );
    return {
      ok: true,
      provider: profile.type,
      model: profile.model,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      category: error.code || "provider",
      message: error.message || "Le provider LLM a refuse le test.",
    };
  }
}

async function listProviderModels(settings) {
  const profile = normalizeProviderProfile(settings);
  if (!profile.baseUrl && profile.type !== "openai-codex") {
    return { ok: false, category: "configuration", message: "L'URL du provider est vide." };
  }
  try {
    let models;
    if (profile.type === "ollama") {
      models = await listOllamaModels({ baseUrl: profile.baseUrl });
    } else if (profile.type === "openai-compatible") {
      models = await listOpenAiCompatibleModels({
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
      });
    } else if (profile.type === "anthropic") {
      models = await listAnthropicModels({ baseUrl: profile.baseUrl, apiKey: profile.apiKey });
    } else if (profile.type === "openai-codex") {
      models = listOpenAiCodexModels();
    } else {
      throw new LlmCallError(`Provider inconnu : ${profile.type}`, { code: "configuration" });
    }
    return {
      ok: true,
      models: [...new Set(models)].sort((left, right) => left.localeCompare(right)),
    };
  } catch (error) {
    return {
      ok: false,
      category: error.code || "provider",
      message: error.message || "Le provider refuse de lister ses modeles.",
    };
  }
}

function getEmbeddingProviderProfile(settings) {
  return getEnabledProviderProfiles(settings)
    .map(normalizeProviderProfile)
    .find((profile) => !["anthropic", "openai-codex"].includes(profile.type) && profile.embeddingModel);
}

function hasEmbeddingProvider(settings) {
  return Boolean(getEmbeddingProviderProfile(settings));
}

async function callProviderEmbedding(settings, text) {
  const profile = getEmbeddingProviderProfile(settings);
  if (!profile) {
    throw new LlmCallError("Aucun profil actif avec modele d'embedding n'est configure.", {
      code: "configuration",
    });
  }
  if (profile.type === "ollama") {
    return callOllamaEmbedding({
      baseUrl: profile.baseUrl,
      model: profile.embeddingModel,
      text,
    });
  }
  if (profile.type === "openai-compatible") {
    return callOpenAiCompatibleEmbedding({
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.embeddingModel,
      text,
    });
  }
  throw new LlmCallError(`Embeddings indisponibles pour ${profile.type}.`);
}
