import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { createMemoryBackend, setStorageBackend } from "../../src/core/storage.js";
import {
  DEFAULT_CONFIG,
  getSecret,
  invalidateConfigCache,
  loadConfig,
  normalizeProfile,
  pruneSecrets,
  saveConfig,
  setSecret,
} from "../../src/core/settings.js";
import { setLogLevel } from "../../src/core/logger.js";

setLogLevel("silent");

let backend;

beforeEach(() => {
  backend = createMemoryBackend();
  setStorageBackend(backend);
  invalidateConfigCache();
});

test("une installation neuve part des valeurs par defaut", async () => {
  const config = await loadConfig();
  assert.equal(config.version, 2);
  assert.deepEqual(config.llm.profiles, []);
  assert.equal(config.privacy.allowRemoteProviders, false, "aucun envoi distant sans accord");
  assert.equal(config.mail.allFolders, false);
});

test("un profil sans modele est refuse avec un message explicite", () => {
  assert.throws(
    () => normalizeProfile({ provider: "ollama", label: "Local", baseUrl: "http://localhost:11434" }),
    /n'a pas de modele selectionne/
  );
  assert.throws(() => normalizeProfile({ provider: "inconnu", model: "x" }), /Fournisseur inconnu/);
});

test("un service distant en HTTP est refuse, localhost reste tolere", () => {
  assert.throws(
    () => normalizeProfile({ provider: "openai", model: "gpt-4o", baseUrl: "http://api.exemple.fr/v1" }),
    /doit utiliser HTTPS/
  );
  const local = normalizeProfile({
    provider: "ollama",
    model: "llama3",
    baseUrl: "http://localhost:11434/",
  });
  assert.equal(local.baseUrl, "http://localhost:11434");
});

test("un profil corrompu est ecarte sans emporter les autres", async () => {
  backend = createMemoryBackend({
    config: {
      version: 2,
      llm: {
        profiles: [
          { id: "bon", provider: "ollama", model: "llama3", baseUrl: "http://localhost:11434" },
          { id: "casse", provider: "ollama", model: "" },
        ],
      },
    },
  });
  setStorageBackend(backend);
  invalidateConfigCache();
  const config = await loadConfig();
  assert.equal(config.llm.profiles.length, 1);
  assert.equal(config.llm.profiles[0].id, "bon");
});

test("les secrets sont stockes hors de la configuration", async () => {
  await saveConfig({
    llm: {
      profiles: [{
        id: "p1", provider: "openai", model: "gpt-4o", baseUrl: "https://api.openai.com/v1",
      }],
    },
  });
  await setSecret("p1", { apiKey: "sk-prive" });

  const stored = backend.snapshot();
  assert.equal(JSON.stringify(stored.config).includes("sk-prive"), false, "la config ne porte aucun secret");
  assert.deepEqual(Object.keys(stored.secrets), ["p1"], "les secrets vivent dans leur propre cle");
  assert.equal((await getSecret("p1")).apiKey, "sk-prive");
});

test("les secrets orphelins disparaissent avec leur profil", async () => {
  await setSecret("p1", { apiKey: "sk-1" });
  await setSecret("p2", { apiKey: "sk-2" });
  await pruneSecrets(["p1"]);
  assert.equal((await getSecret("p1")).apiKey, "sk-1");
  assert.deepEqual(await getSecret("p2"), {});
});

test("la configuration version 1 est migree, secrets compris", async () => {
  backend = createMemoryBackend({
    llmProvider: "ollama",
    providerBaseUrl: "http://localhost:11434",
    providerModel: "llama3.1",
    llmProfiles: [
      {
        id: "legacy-1", name: "Ollama maison", type: "ollama",
        baseUrl: "http://localhost:11434", model: "llama3.1", enabled: true,
      },
      {
        id: "legacy-2", name: "GPT", type: "openai-compatible",
        baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "sk-ancienne", enabled: true,
      },
      {
        id: "legacy-3", name: "Claude", type: "anthropic",
        baseUrl: "https://api.anthropic.com", model: "claude-3-5-sonnet", apiKey: "sk-ant", enabled: false,
      },
    ],
    preferredProviderId: "legacy-2",
    openAiCodexCredentials: {},
    remoteDataConsentAccepted: true,
    summaryHour: 7,
    summaryMinute: 30,
    minConfidence: "haute",
    uiLanguage: "en",
    maxEmailsPerRun: 60,
  });
  setStorageBackend(backend);
  invalidateConfigCache();

  const config = await loadConfig();

  assert.equal(config.version, 2);
  assert.equal(config.language, "en");
  assert.equal(config.privacy.allowRemoteProviders, true);
  assert.equal(config.reports.hour, 7);
  assert.equal(config.reports.minute, 30);
  assert.equal(config.calendar.minConfidence, "haute");
  assert.equal(config.mail.maxMessagesPerRun, 60);

  // Le profil prefere de la v1 devient le premier de la chaine de repli.
  assert.deepEqual(config.llm.profiles.map((profile) => profile.id), ["legacy-2", "legacy-1", "legacy-3"]);
  assert.deepEqual(config.llm.profiles.map((profile) => profile.provider), ["openai", "ollama", "anthropic"]);
  assert.equal(config.llm.profiles[2].enabled, false);

  // Les cles quittent les profils pour le coffre.
  assert.equal(JSON.stringify(config).includes("sk-ancienne"), false);
  assert.equal((await getSecret("legacy-2")).apiKey, "sk-ancienne");
  assert.equal((await getSecret("legacy-3")).apiKey, "sk-ant");
});

test("un profil Codex v1 conserve ses jetons OAuth", async () => {
  backend = createMemoryBackend({
    llmProfiles: [{
      id: "codex-1", name: "ChatGPT", type: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api/codex", model: "gpt-5.1-codex", enabled: true,
    }],
    openAiCodexCredentials: {
      "codex-1": { accessToken: "at", refreshToken: "rt", expiresAt: 111, email: "a@b.c" },
    },
  });
  setStorageBackend(backend);
  invalidateConfigCache();

  const config = await loadConfig();
  assert.equal(config.llm.profiles[0].provider, "chatgpt");
  assert.equal((await getSecret("codex-1")).oauth.refreshToken, "rt");
});

test("la sauvegarde n'accepte que les sections connues", async () => {
  const config = await saveConfig({ inconnu: { x: 1 }, reports: { hour: 6 } });
  assert.equal(config.inconnu, undefined);
  assert.equal(config.reports.hour, 6);
  assert.equal(config.reports.minute, DEFAULT_CONFIG.reports.minute, "les champs non fournis sont conserves");
});
