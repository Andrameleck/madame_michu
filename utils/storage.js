// Acces centralise a messenger.storage.local. La cle API n'est jamais lue/ecrite
// ailleurs que via ce module, afin d'avoir un seul point d'audit.

// Reglages modifiables depuis la page d'options. Cette table est la reference
// unique : ui/options/options.js la charge au lieu d'en tenir une copie, qui
// avait deja diverge.
const SETTINGS_DEFAULTS = {
  llmProvider: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
  providerBaseUrl: "",
  providerModel: "",
  apiKey: "",
  llmProfiles: [],
  preferredProviderId: "",
  summaryHour: 8,
  summaryMinute: 0,
  autoRefreshMinutes: 60,
  sourceAllAccounts: true,
  sourceAccountIds: [],
  scanAllFolders: true,
  scanFolders: ["INBOX"],
  minConfidence: "moyenne", // "haute" | "moyenne" | "basse"
  autoCreateEvents: true,
  defaultCalendarId: "",
  maxEmailsPerRun: 40,
  maxBodyChars: 2000,
  dryRun: false,
  webSearchEnabled: false,
  remoteDataConsentAccepted: false,
  externalBriefEnabled: false,
  weatherLocation: "",
  externalNewsTopics: [],
  uiLanguage: "fr",

  // --- Chat mailbox (RAG par embeddings) ---
  embeddingModel: "nomic-embed-text",
  indexAllFolders: true,
  indexFolders: ["INBOX"],
  indexLookbackDays: 90,
  indexBodyChars: 3000,
  indexBatchSize: 100,
  chatTopK: 6,
};

// Etat produit par l'extension, jamais edite directement par l'utilisateur.
const RUNTIME_STATE_DEFAULTS = {
  lastSummary: null, // { generatedAt, summaryHtml, events: [] }
  lastSummaryDay: null,
  lastSummaryWeek: null,
  lastSummaryMonth: null,
  lastIndexedAt: null,
};

const STORAGE_DEFAULTS = { ...SETTINGS_DEFAULTS, ...RUNTIME_STATE_DEFAULTS };

async function getSettings() {
  const [stored, codexStorage] = await Promise.all([
    messenger.storage.local.get(STORAGE_DEFAULTS),
    messenger.storage.local.get({ openAiCodexCredentials: {} }),
  ]);
  const settings = {
    ...STORAGE_DEFAULTS,
    ...stored,
    providerBaseUrl: stored.providerBaseUrl || stored.ollamaBaseUrl,
    providerModel: stored.providerModel || stored.ollamaModel,
  };
  if (!Array.isArray(settings.llmProfiles) || settings.llmProfiles.length === 0) {
    settings.llmProfiles = [{
      id: "legacy-primary",
      name: "Provider principal",
      enabled: true,
      type: settings.llmProvider,
      baseUrl: settings.providerBaseUrl,
      model: settings.providerModel,
      apiKey: settings.apiKey,
      embeddingModel: settings.embeddingModel,
    }];
  }

  // Les jetons OAuth sont stockes separement des profils. Si Thunderbird a
  // conserve la connexion mais perdu la liste des profils lors d'un rechargement,
  // reconstruire le profil evite un repli silencieux vers l'Ollama par defaut.
  const knownProfileIds = new Set(settings.llmProfiles.map((profile) => profile.id));
  const recoveredCodexProfiles = Object.entries(codexStorage.openAiCodexCredentials || {})
    .filter(([profileId, credentials]) =>
      !knownProfileIds.has(profileId) && (credentials?.refreshToken || credentials?.accessToken)
    )
    .map(([profileId, credentials]) => ({
      id: profileId,
      name: credentials.email ? `ChatGPT - ${credentials.email}` : "ChatGPT recupere",
      enabled: true,
      type: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      model: "gpt-5.1-codex-mini",
      apiKey: "",
      embeddingModel: "",
    }));
  if (recoveredCodexProfiles.length) {
    settings.llmProfiles.push(...recoveredCodexProfiles);
    if (!settings.preferredProviderId) {
      settings.preferredProviderId = recoveredCodexProfiles[0].id;
    }
    await messenger.storage.local.set({
      llmProfiles: settings.llmProfiles,
      preferredProviderId: settings.preferredProviderId,
    });
  }
  return settings;
}

const SUMMARY_STORAGE_KEYS = {
  day: "lastSummaryDay",
  week: "lastSummaryWeek",
  month: "lastSummaryMonth",
};

async function saveLastSummary(lastSummary, range = "day") {
  const key = SUMMARY_STORAGE_KEYS[range] || SUMMARY_STORAGE_KEYS.day;
  await messenger.storage.local.set({
    [key]: lastSummary,
    ...(range === "day" ? { lastSummary } : {}),
  });
}

async function getLastSummary(range = "day") {
  const key = SUMMARY_STORAGE_KEYS[range] || SUMMARY_STORAGE_KEYS.day;
  const stored = await messenger.storage.local.get({ [key]: null, lastSummary: null });
  return stored[key] || (range === "day" ? stored.lastSummary : null);
}

async function setLastIndexedAt(isoDate) {
  await messenger.storage.local.set({ lastIndexedAt: isoDate });
}
