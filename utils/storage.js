// Acces centralise a messenger.storage.local. La cle API n'est jamais lue/ecrite
// ailleurs que via ce module, afin d'avoir un seul point d'audit.

const STORAGE_DEFAULTS = {
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
  scanAllFolders: true,
  scanFolders: ["INBOX"],
  minConfidence: "moyenne", // "haute" | "moyenne" | "basse"
  autoCreateEvents: true,
  defaultCalendarId: "",
  maxEmailsPerRun: 40,
  maxBodyChars: 2000,
  dryRun: false,
  lastSummary: null, // { generatedAt, summaryHtml, events: [] }
  lastSummaryDay: null,
  lastSummaryWeek: null,
  lastSummaryMonth: null,

  // --- Chat mailbox (RAG par embeddings) ---
  embeddingModel: "nomic-embed-text",
  indexAllFolders: true,
  indexFolders: ["INBOX"],
  indexLookbackDays: 90,
  indexBodyChars: 3000,
  indexBatchSize: 100,
  chatTopK: 6,
  lastIndexedAt: null,
};

async function getSettings() {
  const stored = await messenger.storage.local.get(STORAGE_DEFAULTS);
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
  return settings;
}

async function setSettings(partial) {
  await messenger.storage.local.set(partial);
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
