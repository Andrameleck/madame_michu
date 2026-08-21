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
