const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("stocke independamment les resumes du jour, de la semaine et du mois", async () => {
  const stored = { lastSummary: { id: "legacy-day" } };
  const context = vm.createContext({
    messenger: {
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults, ...stored }),
          set: async (values) => Object.assign(stored, values),
        },
      },
    },
  });
  vm.runInContext(readFileSync(join(__dirname, "..", "utils", "storage.js"), "utf8"), context);

  const legacy = await vm.runInContext('getLastSummary("day")', context);
  assert.equal(legacy.id, "legacy-day");

  context.weekSummary = { id: "week" };
  await vm.runInContext('saveLastSummary(weekSummary, "week")', context);

  assert.equal(stored.lastSummaryWeek.id, "week");
  assert.equal(stored.lastSummary.id, "legacy-day");
});

test("convertit automatiquement l'ancien provider unique en profil", async () => {
  const stored = {
    llmProvider: "openai-compatible",
    providerBaseUrl: "https://api.example/v1",
    providerModel: "chat-model",
    apiKey: "secret",
    embeddingModel: "embed-model",
  };
  const context = vm.createContext({
    messenger: {
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults, ...stored }),
          set: async (values) => Object.assign(stored, values),
        },
      },
    },
  });
  vm.runInContext(readFileSync(join(__dirname, "..", "utils", "storage.js"), "utf8"), context);

  const settings = await vm.runInContext("getSettings()", context);

  assert.equal(settings.llmProfiles.length, 1);
  assert.equal(settings.llmProfiles[0].type, "openai-compatible");
  assert.equal(settings.llmProfiles[0].model, "chat-model");
  assert.equal(settings.llmProfiles[0].embeddingModel, "embed-model");
});

test("recupere un profil ChatGPT OAuth perdu et le rend prioritaire", async () => {
  const stored = {
    openAiCodexCredentials: {
      "codex-recovered": {
        refreshToken: "refresh-secret",
        email: "michu@example.test",
      },
    },
  };
  const context = vm.createContext({
    messenger: {
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults, ...stored }),
          set: async (values) => Object.assign(stored, values),
        },
      },
    },
  });
  vm.runInContext(readFileSync(join(__dirname, "..", "utils", "storage.js"), "utf8"), context);

  const settings = await vm.runInContext("getSettings()", context);
  const recovered = settings.llmProfiles.find((profile) => profile.id === "codex-recovered");

  assert.equal(recovered.type, "openai-codex");
  assert.equal(recovered.model, "gpt-5.1-codex-mini");
  assert.equal(settings.preferredProviderId, "codex-recovered");
  assert.equal(stored.preferredProviderId, "codex-recovered");
  assert.equal(stored.llmProfiles.length, 2);
});
