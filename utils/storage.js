// Acces centralise a messenger.storage.local. La cle API n'est jamais lue/ecrite
// ailleurs que via ce module, afin d'avoir un seul point d'audit.

const STORAGE_DEFAULTS = {
  llmProvider: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
  apiKey: "", // reserve pour un futur provider distant (Claude/OpenAI)
  summaryHour: 8,
  summaryMinute: 0,
  scanFolders: ["INBOX"],
  minConfidence: "moyenne", // "haute" | "moyenne" | "basse"
  maxEmailsPerRun: 40,
  maxBodyChars: 2000,
  dryRun: false,
  lastSummary: null, // { generatedAt, summaryHtml, events: [] }
};

async function getSettings() {
  const stored = await messenger.storage.local.get(STORAGE_DEFAULTS);
  return { ...STORAGE_DEFAULTS, ...stored };
}

async function setSettings(partial) {
  await messenger.storage.local.set(partial);
}

async function getApiKey() {
  const { apiKey } = await messenger.storage.local.get({ apiKey: "" });
  return apiKey;
}

async function setApiKey(apiKey) {
  await messenger.storage.local.set({ apiKey });
}

async function saveLastSummary(lastSummary) {
  await messenger.storage.local.set({ lastSummary });
}

async function getLastSummary() {
  const { lastSummary } = await messenger.storage.local.get({ lastSummary: null });
  return lastSummary;
}
