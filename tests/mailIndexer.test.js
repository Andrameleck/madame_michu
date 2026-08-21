const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("indexe les mails en mode lexical sans modele d'embedding", async () => {
  let storedRecord = null;
  const emails = [{
    id: "account:message@example.test",
    subject: "Contrat",
    author: "Alice",
    date: "2026-08-20T08:00:00.000Z",
    folder: "/INBOX",
    bodyText: "Le contrat est signe.",
  }];
  Object.defineProperty(emails, "diagnostics", {
    value: { matchedFolders: [{ id: "inbox" }] },
  });
  const context = vm.createContext({
    Date,
    getSettings: async () => ({
      embeddingModel: "",
      indexLookbackDays: 90,
      indexFolders: ["INBOX"],
      indexBatchSize: 100,
      indexBodyChars: 3000,
    }),
    getAllVectorIds: async () => new Set(),
    fetchEmails: async () => emails,
    upsertVector: async (record) => {
      storedRecord = record;
    },
    countVectors: async () => 1,
    hasEmbeddingProvider: () => false,
    setLastIndexedAt: async () => {},
    logger: { info() {}, warn() {} },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailIndexer.js"), "utf8"),
    context
  );
  const result = await vm.runInContext("indexMailbox()", context);

  assert.equal(result.indexed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.mode, "lexical");
  assert.equal(storedRecord.embedding, null);
});

test("poursuit en index lexical si le provider d'embedding echoue", async () => {
  const storedRecords = [];
  const emails = [1, 2].map((id) => ({
    id: `account:message-${id}@example.test`,
    subject: `Message ${id}`,
    author: "Alice",
    date: "2026-08-20T08:00:00.000Z",
    folder: "/INBOX",
    bodyText: "Corps utile.",
  }));
  Object.defineProperty(emails, "diagnostics", {
    value: { matchedFolders: [{ id: "inbox" }], folderErrors: [] },
  });
  let embeddingCalls = 0;
  const context = vm.createContext({
    Date,
    getSettings: async () => ({
      embeddingModel: "modele-indisponible",
      indexLookbackDays: 90,
      indexFolders: ["INBOX"],
      indexBatchSize: 100,
      indexBodyChars: 3000,
    }),
    getAllVectorIds: async () => new Set(),
    fetchEmails: async () => emails,
    upsertVector: async (record) => storedRecords.push(record),
    countVectors: async () => storedRecords.length,
    hasEmbeddingProvider: () => true,
    callProviderEmbedding: async () => {
      embeddingCalls++;
      throw new Error("HTTP 403");
    },
    setLastIndexedAt: async () => {},
    logger: { info() {}, warn() {} },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailIndexer.js"), "utf8"),
    context
  );

  const result = await vm.runInContext("indexMailbox()", context);

  assert.equal(embeddingCalls, 1);
  assert.equal(storedRecords.length, 2);
  assert.equal(storedRecords[0].embedding, null);
  assert.equal(result.failed, 0);
  assert.equal(result.mode, "lexical (secours)");
  assert.match(result.embeddingFallbackReason, /403/);
});
