const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("repond a la prochaine reunion depuis le calendrier sans exiger d'index mail", async () => {
  let indexReads = 0;
  const context = vm.createContext({
    Date,
    Intl,
    getUpcomingCalendarEvents: async () => [{
      id: "event-1",
      title: "Point equipe",
      startDate: "2099-08-21T09:00:00.000Z",
      location: "Salle Mars",
      calendarName: "Travail",
      allDay: false,
    }],
    countVectors: async () => {
      indexReads++;
      return 0;
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext(
    'answerMailboxQuestion("Quand est ma prochaine reunion ?")',
    context
  );

  assert.match(result.answer, /Point equipe/);
  assert.match(result.answer, /Salle Mars/);
  assert.equal(result.sources[0].type, "calendar");
  assert.equal(result.sources[0].calendarName, "Travail");
  assert.equal(indexReads, 0);
});

test("continue vers le LLM de secours si le provider d'embedding est indisponible", async () => {
  let lexicalSearches = 0;
  let chatCalls = 0;
  const mail = {
    id: "mail-1",
    subject: "Projet Optirrig",
    author: "equipe@example.test",
    date: "2026-08-21T08:00:00.000Z",
    folder: "INBOX",
    excerpt: "Le document est pret.",
  };
  const context = vm.createContext({
    Date,
    Intl,
    countVectors: async () => 1,
    getSettings: async () => ({ chatTopK: 6 }),
    hasEmbeddingProvider: () => true,
    callProviderEmbedding: async () => {
      throw new Error("provider embedding hors ligne");
    },
    searchSimilar: async () => {
      throw new Error("ne doit pas etre appele");
    },
    searchLexical: async () => {
      lexicalSearches++;
      return [{ record: mail, score: 0.8 }];
    },
    callProviderChat: async () => {
      chatCalls++;
      return "Le secours repond a partir du mail [Mail 1].";
    },
    logger: { warn: () => {} },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext(
    'answerMailboxQuestion("Ou en est le projet Optirrig ?")',
    context
  );

  assert.equal(lexicalSearches, 1);
  assert.equal(chatCalls, 1);
  assert.match(result.answer, /secours/);
  assert.equal(result.sources[0].id, "mail-1");
  assert.equal(result.retrieval.mode, "lexicale (secours)");
});

test("fusionne recherche semantique et lexicale en privilegiant leur accord", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );
  context.semantic = [
    { record: { id: "semantic-only" }, score: 0.95 },
    { record: { id: "both" }, score: 0.75 },
  ];
  context.lexical = [
    { record: { id: "both" }, score: 0.9 },
    { record: { id: "lexical-only" }, score: 0.8 },
  ];

  const matches = vm.runInContext("mergeSearchResults(semantic, lexical, 3)", context);

  assert.equal(matches[0].record.id, "both");
  assert.deepEqual(new Set(matches.map((match) => match.record.id)), new Set([
    "both",
    "semantic-only",
    "lexical-only",
  ]));
});

test("utilise les questions precedentes pour une recherche de suivi", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );
  context.history = [
    { role: "user", content: "Que dit Alice sur le contrat Optirrig ?" },
    { role: "assistant", content: "Elle attend une validation." },
  ];

  const query = vm.runInContext('buildRetrievalQuery("Et pour quelle date ?", history)', context);

  assert.match(query, /Alice/);
  assert.match(query, /contrat Optirrig/);
  assert.match(query, /quelle date/);
  assert.doesNotMatch(query, /validation/);
});

test("actualise automatiquement un index ancien avant la recherche", async () => {
  let indexCalls = 0;
  const mail = {
    id: "mail-1",
    subject: "Budget",
    author: "Alice",
    date: "2026-08-21T08:00:00.000Z",
    folder: "INBOX",
    excerpt: "Validation attendue vendredi.",
  };
  const context = vm.createContext({
    Date,
    Intl,
    getSettings: async () => ({
      chatTopK: 6,
      lastIndexedAt: "2020-01-01T00:00:00.000Z",
    }),
    indexMailbox: async () => {
      indexCalls++;
      return { indexed: 1, failed: 0 };
    },
    countVectors: async () => 1,
    hasEmbeddingProvider: () => false,
    searchLexical: async () => [{ record: mail, score: 0.9 }],
    callProviderChat: async () => "Le budget doit etre valide vendredi [Mail 1].",
    logger: { warn() {} },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext('answerMailboxQuestion("Quand valider le budget ?")', context);

  assert.equal(indexCalls, 1);
  assert.equal(result.retrieval.indexRefresh.indexed, 1);
  assert.equal(result.retrieval.mode, "lexicale");
});
