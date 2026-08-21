const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("donne a Madame Michu une personnalite blasee et vindicative sans relacher les sources", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const prompt = vm.runInContext("CHAT_SYSTEM_PROMPT", context);

  assert.match(prompt, /cinglante, profondement blasee/);
  assert.match(prompt, /rancuniere et vindicative/);
  assert.match(prompt, /Chaque sollicitation.*t'interrompt et t'agace serieusement/);
  assert.match(prompt, /CHAQUE reponse/);
  assert.match(prompt, /a contrecœur/);
  assert.match(prompt, /sans jamais refuser, menacer, saboter/);
  assert.match(prompt, /ne doit jamais la retarder/);
  assert.match(prompt, /\[Mail N\]/);
  assert.match(prompt, /n'invente rien/);
});

test("papote sans consulter l'index quand le mode le demande", async () => {
  let chatMessages = null;
  const context = vm.createContext({
    Date,
    Intl,
    getSettings: async () => ({ chatTopK: 6 }),
    countVectors: async () => {
      throw new Error("L'index ne doit pas etre consulte");
    },
    callProviderChat: async (_settings, messages) => {
      chatMessages = messages;
      return "Entre nous, même les spams ont parfois plus de conversation que le troisième étage.";
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext(
    `answerMailboxQuestion("Raconte-moi une blague", {
      scope: "casual",
      history: [
        { role: "user", content: "Quel est le budget ?", scope: "mail" },
        { role: "assistant", content: "Le budget secret est 42 euros.", scope: "mail" },
        { role: "user", content: "Bonjour Michu", scope: "casual" }
      ]
    })`,
    context
  );

  assert.equal(result.retrieval.mode, "papotage");
  assert.deepEqual(Array.from(result.sources), []);
  assert.match(chatMessages[0].content, /hors de l'index des mails/);
  assert.match(chatMessages[0].content, /t'emmerde serieusement/);
  assert.match(chatMessages[0].content, /CHAQUE reponse/);
  assert.equal(chatMessages.some((message) => /budget secret/.test(message.content)), false);
  assert.equal(chatMessages.some((message) => /Bonjour Michu/.test(message.content)), true);
  assert.doesNotMatch(result.answer, /\[Mail/);
});

test("detecte automatiquement une demande de blague comme du papotage", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  assert.equal(vm.runInContext('resolveChatScope("auto", "Tu me racontes une blague ?")', context), "casual");
  assert.equal(vm.runInContext('resolveChatScope("auto", "Alors, quels sont les ragots ?")', context), "gossip");
  assert.equal(vm.runInContext('resolveChatScope("auto", "Quoi de neuf ?")', context), "gossip");
  assert.equal(vm.runInContext('resolveChatScope("auto", "Que dit Marc sur le budget ?")', context), "mail");
});

test("compose naturellement les ragots a partir de vrais mails recents et les cite", async () => {
  let chatMessages = null;
  const recentMail = {
    id: "mail-ragot-1",
    subject: "Encore un report de la presentation",
    author: "direction@example.test",
    date: "2026-08-21T08:00:00.000Z",
    folder: "INBOX",
    excerpt: "La presentation est repoussee pour la troisieme fois.",
  };
  const context = vm.createContext({
    Date,
    Intl,
    getSettings: async () => ({ chatTopK: 6 }),
    countVectors: async () => 1,
    hasEmbeddingProvider: () => false,
    searchLexical: async () => [],
    getAllVectors: async () => [recentMail],
    callProviderChat: async (_settings, messages) => {
      chatMessages = messages;
      return "La presentation tient mieux du mirage : elle vient d'etre repoussee une troisieme fois [Mail 1]. A ce rythme, elle sera prete pour les archives.";
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext(
    'answerMailboxQuestion("Quels sont les derniers ragots ?", { scope: "auto" })',
    context
  );

  assert.equal(result.retrieval.chatScope, "gossip");
  assert.equal(result.sources[0].id, "mail-ragot-1");
  assert.match(chatMessages[0].content, /Integre le detail naturellement/);
  assert.match(chatMessages[0].content, /comparaison/);
  assert.match(chatMessages[0].content, /Termine par un commentaire cynique/);
  assert.match(chatMessages[0].content, /L'utilisateur t'agacait/);
  assert.match(chatMessages[0].content, /rancune/);
  assert.match(chatMessages[0].content, /pas dans des\s+majuscules/);
  assert.match(chatMessages.at(-1).content, /repoussee pour la troisieme fois/);
  assert.match(result.answer, /\[Mail 1\]/);
});

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
  assert.match(result.answer, /Tu interromps vraiment/);
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
