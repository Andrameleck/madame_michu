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
  assert.match(prompt, /rancuniere et volontiers desagreable/);
  assert.match(prompt, /L'utilisateur t'interrompt et cela t'agace/);
  assert.match(prompt, /tu n'as pas besoin de l'annoncer a chaque reponse/);
  assert.match(prompt, /a contrecœur/);
  assert.match(prompt, /sans jamais refuser, menacer, saboter/);
  assert.match(prompt, /ne doit jamais la retarder/);
  assert.match(prompt, /\[Mail N\]/);
  assert.match(prompt, /n'invente rien/);
});

test("connait ses tics de concierge sans les rendre obligatoires", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"), context);
  const prompt = vm.runInContext('personalizeChatPrompt(CHAT_SYSTEM_PROMPT, "", "fr")', context);
  for (const phrase of [
    "les prospectus", "les machines qui écrivent toutes seules", "les démarcheurs",
    "les réunions de palier", "les gens qui découvrent l’organisation au dernier moment",
    "buffet entier par courrier",
  ]) assert.match(prompt, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(prompt, /au maximum un/);
  assert.match(prompt, /lorsque la situation correspond vraiment/);
});

test("dose ses expressions francaises et britanniques au lieu de les reciter", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"), context);
  const french = vm.runInContext('personalizeChatPrompt(CHAT_SYSTEM_PROMPT, "", "fr")', context);
  const english = vm.runInContext('personalizeChatPrompt(CHAT_SYSTEM_PROMPT, "", "en")', context);
  assert.match(french, /une reponse sur trois/);
  assert.match(french, /jamais dans deux reponses consecutives/);
  assert.match(french, /On aura tout vu/);
  assert.match(french, /Moi, ce que j’en dis/);
  assert.match(french, /Vous savez, moi, de mon temps/);
  assert.match(french, /observation volontairement banale/);
  assert.match(english, /roughly one reply out of three/);
  assert.match(english, /two consecutive replies/);
  assert.match(english, /takes the biscuit/);
  assert.match(english, /lighting up Buckingham Palace/);
  assert.match(english, /You know, in my day/);
  assert.match(english, /deliberately mundane observation/);
});

test("habille Madame Michu en concierge britannique en mode anglais", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );
  const prompt = vm.runInContext('personalizeChatPrompt(CASUAL_CHAT_SYSTEM_PROMPT, "Florian", "en")', context);
  assert.match(prompt, /natural British English/);
  assert.match(prompt, /British spelling, vocabulary and idiom/);
  assert.match(prompt, /Never use Americanisms/);
  assert.match(prompt, /Florian/);
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

test("restitue les sources de recherche web pendant le papotage quand l'option est active", async () => {
  let requestedWebSearch;
  const context = vm.createContext({
    Date,
    Intl,
    URL,
    getSettings: async () => ({ chatTopK: 6, webSearchEnabled: true }),
    countVectors: async () => {
      throw new Error("L'index ne doit pas etre consulte");
    },
    callProviderChat: async (_settings, _messages, options) => {
      requestedWebSearch = options?.webSearch;
      return {
        text: "Paraît qu'il pleut sur Bordeaux, comme si j'avais que ça à faire de le savoir.",
        sources: [{ url: "https://meteo.example/bordeaux", title: "Meteo Bordeaux" }],
      };
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext(
    `answerMailboxQuestion("Il fait quel temps a Bordeaux ?", { scope: "casual", history: [] })`,
    context
  );

  assert.equal(requestedWebSearch, true);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].type, "external");
  assert.equal(result.sources[0].url, "https://meteo.example/bordeaux");
  assert.equal(result.sources[0].subject, "Meteo Bordeaux");
  assert.equal(result.sources[0].author, "meteo.example");
});

test("detecte automatiquement une demande de blague comme du papotage", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  assert.equal(vm.runInContext('resolveChatScope("auto", "Tu me racontes une blague ?")', context), "casual");
  assert.equal(vm.runInContext('resolveChatScope("auto", "Do you know a joke?")', context), "casual");
  assert.equal(vm.runInContext('resolveChatScope("auto", "a jock,")', context), "casual");
  assert.equal(vm.runInContext('resolveChatScope("auto", "Hey, ma belle")', context), "casual");
  assert.equal(vm.runInContext('resolveChatScope("auto", "Vous avez vu hier le facteur ? Dans quel monde on vit !")', context), "casual");
  assert.equal(vm.runInContext('resolveChatScope("auto", "Avez-vous vu le mail de Marc ?")', context), "mail");
  assert.equal(vm.runInContext('resolveChatScope("auto", "Alors, quels sont les ragots ?")', context), "gossip");
  assert.equal(vm.runInContext('resolveChatScope("auto", "Quoi de neuf ?")', context), "mail");
  assert.equal(vm.runInContext('resolveChatScope("auto", "Salut, quoi de neuf aujourd\'hui ?")', context), "mail");
  assert.equal(vm.runInContext('isMailboxNewsQuestion("Quoi de neuf ?")', context), true);
  assert.equal(vm.runInContext('isMailboxNewsQuestion("Que s\'est-il passe hier ?")', context), true);
  assert.equal(vm.runInContext(`isMailboxNewsQuestion("What's new?")`, context), true);
  assert.equal(vm.runInContext(`isMailboxNewsQuestion("What's new, gossip girl?")`, context), false);
  assert.equal(vm.runInContext(`resolveChatScope("auto", "What's new, gossip girl?")`, context), "gossip");
  assert.equal(vm.runInContext('isUpcomingCalendarQuestion("When is my next meeting?")', context), true);
  assert.equal(vm.runInContext('resolveChatScope("auto", "Que dit Marc sur le budget ?")', context), "mail");
});

test("n'affiche que les mails cites interieurement par la reponse", async () => {
  const mails = [
    { id: "utile", subject: "Budget", author: "Alice", date: "2026-08-21T08:00:00Z", folder: "INBOX", excerpt: "Budget valide." },
    { id: "inutile", subject: "Webinar", author: "Info", date: "2026-08-21T07:00:00Z", folder: "INBOX", excerpt: "Invitation." },
  ];
  const context = vm.createContext({
    Date,
    Intl,
    getSettings: async () => ({ chatTopK: 6 }),
    countVectors: async () => 2,
    hasEmbeddingProvider: () => false,
    searchLexical: async () => mails.map((record) => ({ record, score: 0.8 })),
    callProviderChat: async () => "Le budget est valide [Mail 1].",
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext(
    'answerMailboxQuestion("Le budget est-il valide ?")',
    context
  );

  assert.deepEqual(Array.from(result.sources, (source) => source.id), ["utile"]);
  assert.equal(result.retrieval.candidateCount, 2);
  assert.equal(result.retrieval.sourceCount, 1);
  assert.doesNotMatch(result.answer, /\[Mail/);
});

test("relance sur une reponse precedente : va chercher d'autres mails du meme expediteur", async () => {
  const otherMailFromSameSender = {
    id: "bruno-precedent",
    subject: "Point Optirrig",
    author: "Bruno Cheviron <bruno.cheviron@inrae.fr>",
    date: "2026-07-10T08:00:00Z",
    folder: "INBOX",
    excerpt: "Le point Optirrig concerne le projet PILOTE.",
  };
  let receivedMessages = null;
  const context = vm.createContext({
    Date,
    Intl,
    getSettings: async () => ({ chatTopK: 6 }),
    countVectors: async () => 1,
    hasEmbeddingProvider: () => false,
    // La recherche lexicale sur la question de relance ne trouve rien de pertinent :
    // seul le repli sur l'expediteur du tour precedent doit fournir du contexte.
    searchLexical: async () => [],
    getAllVectors: async () => [otherMailFromSameSender],
    callProviderChat: async (_settings, messages) => {
      receivedMessages = messages;
      return "Ca concerne le projet PILOTE [Mail 1].";
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext(
    `answerMailboxQuestion("Quel projet cela concerne ?", {
      history: [
        { role: "user", content: "Dis-m'en plus sur le Cotech", scope: "mail" },
        {
          role: "assistant",
          content: "Le Cotech est prevu le 7 septembre.",
          scope: "mail",
          sources: [{ id: "cotech-mail", author: "Bruno Cheviron <bruno.cheviron@inrae.fr>" }],
        },
      ],
    })`,
    context
  );

  assert.deepEqual(Array.from(result.sources, (source) => source.id), ["bruno-precedent"]);
  assert.ok(receivedMessages.some((message) => /Point Optirrig/.test(message.content)));
});

test("ne joint aucune source quand la reponse n'utilise aucun mail", async () => {
  const mail = { id: "hors-sujet", subject: "Webinar", author: "Info", date: "2026-08-21T07:00:00Z", folder: "INBOX", excerpt: "Invitation." };
  const context = vm.createContext({
    Date,
    Intl,
    getSettings: async () => ({ chatTopK: 6 }),
    countVectors: async () => 1,
    hasEmbeddingProvider: () => false,
    searchLexical: async () => [{ record: mail, score: 0.4 }],
    callProviderChat: async () => "Formidable, tu m'as interrompue pour rien : je ne trouve pas cette information dans tes mails.",
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext('answerMailboxQuestion("Quel est le budget secret ?")', context);

  assert.deepEqual(Array.from(result.sources), []);
  assert.equal(result.retrieval.sourceCount, 0);
});

test("conserve le mode precedent pour une reaction contextuelle", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );
  context.gossipHistory = [
    { role: "user", content: "Quels sont les ragots ?", scope: "gossip" },
    { role: "assistant", content: "La presentation est encore repoussee.", scope: "gossip" },
  ];
  context.mailHistory = [
    { role: "user", content: "Que dit Marc ?", scope: "mail" },
    { role: "assistant", content: "Il attend le document.", scope: "mail" },
  ];
  context.newsHistory = [
    { role: "user", content: "Que s'est-il passe hier ?", scope: "mail" },
    { role: "assistant", content: "Une seule nouvelle.", scope: "mail" },
  ];
  context.casualHistory = [
    { role: "user", content: "Et toi, ca va ?", scope: "casual" },
    { role: "assistant", content: "Je tiens debout.", scope: "casual" },
  ];

  assert.equal(
    vm.runInContext('resolveChatScope("auto", "Ah oui, et ensuite ?", gossipHistory)', context),
    "gossip"
  );
  assert.equal(
    vm.runInContext('resolveChatScope("auto", "Et pourquoi ?", mailHistory)', context),
    "mail"
  );
  assert.equal(
    vm.runInContext('resolveChatScope("auto", "Raconte une blague", gossipHistory)', context),
    "casual"
  );
  assert.equal(
    vm.runInContext('resolveChatScope("auto", "And tell me a joke", mailHistory)', context),
    "casual"
  );
  assert.equal(
    vm.runInContext('mailboxNewsReferenceQuestion("C\'est faux, j\'ai des mails du 20", newsHistory)', context),
    "Que s'est-il passe hier ?"
  );
  assert.equal(
    vm.runInContext('resolveChatScope("auto", "Vu votre age aussi", casualHistory)', context),
    "casual"
  );
  assert.equal(
    vm.runInContext('resolveChatScope("auto", "Et le budget du projet ?", casualHistory)', context),
    "mail"
  );
});

test("recupere le prenom de l'identite Thunderbird sans envoyer l'adresse au LLM", async () => {
  let chatMessages = null;
  const context = vm.createContext({
    Date,
    Intl,
    messenger: {
      accounts: {
        list: async () => [{
          identities: [{ name: "Florian Ricquier", email: "florian.ricquier@inrae.fr" }],
        }],
      },
    },
    getSettings: async () => ({ chatTopK: 6 }),
    callProviderChat: async (_settings, messages) => {
      chatMessages = messages;
      return "Florian, tu pouvais vraiment trouver mieux pour m'occuper.";
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext(
    'answerMailboxQuestion("Raconte-moi une blague", { scope: "casual" })',
    context
  );

  assert.match(chatMessages[0].content, /s'appelle Florian/);
  assert.doesNotMatch(chatMessages[0].content, /florian\.ricquier@inrae\.fr/);
  assert.match(result.answer, /^Florian,/);
});

test("deduit le prenom depuis une adresse quand le nom d'identite est vide", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );
  context.identity = { name: "", email: "alice.dupont@example.test" };

  assert.equal(vm.runInContext("firstNameFromIdentity(identity)", context), "Alice");
});

test("choisit le portrait selon le ton et les informations de la reponse", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const mood = (value) => vm.runInContext(`selectChatMood(${JSON.stringify(value)})`, context);
  assert.equal(mood({ scope: "gossip", sourceCount: 1 }), "ragot");
  assert.equal(mood({ scope: "gossip", sourceCount: 4 }), "ragot-renverse");
  assert.equal(mood({ scope: "mail", sourceCount: 0 }), "epuisee-affaissee");
  assert.equal(mood({ scope: "mail", sourceCount: 4 }), "inspection-penchee");
  assert.equal(mood({ scope: "mail", sourceCount: 1, answer: "C'est urgent et bloque." }), "furieuse");
  assert.equal(mood({ scope: "mail", sourceCount: 1, answer: "Les mails se contredisent." }), "soupconneuse");
  assert.equal(mood({ scope: "casual" }), "exasperee");
  assert.equal(mood({ kind: "calendar", sourceCount: 1 }), "profil-meprisant");
});

test("compose naturellement les ragots a partir de vrais mails sans exposer les marqueurs internes", async () => {
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
  assert.doesNotMatch(result.answer, /\[Mail 1\]/);
});

test("raconte quoi de neuf comme une synthese humaine des evenements recents", async () => {
  let chatMessages = null;
  const recentMails = [
    {
      id: "mail-action",
      subject: "Validation Optirrig",
      author: "Alice",
      date: "2026-08-21T09:00:00.000Z",
      folder: "INBOX",
      excerpt: "Le document doit etre valide avant vendredi.",
    },
    {
      id: "mail-meeting",
      subject: "Reunion projet",
      author: "Marc",
      date: "2026-08-21T08:00:00.000Z",
      folder: "Projets",
      excerpt: "La reunion est deplacee a jeudi 14 h.",
    },
    {
      id: "mail-noise-1",
      subject: "Retrieval using the IMAP4 protocol failed for message: 12",
      author: "Microsoft Exchange Server 2010",
      date: "2026-08-21T07:00:00.000Z",
      folder: "INBOX",
      excerpt: "Automated failure.",
    },
    {
      id: "mail-noise-2",
      subject: "Retrieval using the IMAP4 protocol failed for message: 56",
      author: "Microsoft Exchange Server 2010",
      date: "2026-08-21T06:00:00.000Z",
      folder: "INBOX",
      excerpt: "Automated failure.",
    },
  ];
  const context = vm.createContext({
    Date,
    Intl,
    getSettings: async () => ({ chatTopK: 6, lastIndexedAt: "2026-08-21T09:00:00.000Z" }),
    countVectors: async () => recentMails.length,
    getAllVectors: async () => recentMails,
    callProviderChat: async (_settings, messages) => {
      chatMessages = messages;
      return "- Optirrig attend ta validation [Mail 1].\n- La reunion passe a jeudi [Mail 2].";
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );

  const result = await vm.runInContext(
    'answerMailboxQuestion("Quoi de neuf ?", { scope: "auto" })',
    context
  );

  assert.equal(result.retrieval.chatScope, "mail");
  assert.equal(result.retrieval.mode, "recents");
  assert.match(chatMessages[0].content, /deux phrases completes/);
  assert.match(chatMessages[0].content, /cinglante, agacee et variee/);
  assert.match(chatMessages[0].content, /pas une formule neutre/);
  assert.match(chatMessages[0].content, /une puce par evenement/);
  assert.doesNotMatch(result.answer, /\[Mail \d+\]/);
  assert.match(result.answer, /(?:^|\n)\s*-/);
  assert.match(result.answer, /Optirrig attend ta validation/);
  assert.equal(result.sources.some((source) => source.id === "mail-noise-2"), false);
});

test("ne confond pas hier avec le dernier mail disponible", async () => {
  const records = [
    { id: "hier", subject: "Le 20", author: "Alice", date: "2026-08-20T10:00:00+02:00" },
    { id: "ancien", subject: "Le 17", author: "Marc", date: "2026-08-17T10:00:00+02:00" },
  ];
  const context = vm.createContext({
    Date,
    Intl,
    getAllVectors: async () => records,
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"),
    context
  );
  const result = await vm.runInContext(
    'searchRecentMailboxNews({ chatTopK: 6 }, "Que s\'est-il passe hier ?", new Date("2026-08-21T12:00:00+02:00").getTime())',
    context
  );

  assert.deepEqual(Array.from(result.matches, ({ record }) => record.id), ["hier"]);
  const instruction = vm.runInContext(
    'mailboxNewsTimeInstruction("Que s\'est-il passe hier ?", "fr", new Date("2026-08-21T12:00:00+02:00").getTime())',
    context
  );
  assert.match(instruction, /vendredi 21 ao[uû]t 2026/i);
  assert.match(instruction, /jeudi 20 ao[uû]t 2026/i);
  const datedContext = vm.runInContext(
    'buildChatContext([{ record: { id: "hier", author: "Alice", subject: "Test", date: "2026-08-20T10:00:00+02:00", folder: "INBOX", excerpt: "Info" } }], "fr")',
    context
  );
  assert.match(datedContext, /2026-08-20T08:00:00\.000Z/);
  assert.match(datedContext, /20 ao[uû]t 2026/i);
});

test("compose quoi de neuf avec mails du jour, annonces anciennes, calendrier et actualites", async () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);
  const old = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000);
  const targetDate = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  const records = [
    { id: "received-today", subject: "Decision du jour", author: "Alice", date: today.toISOString(), folder: "INBOX", excerpt: "Le budget est valide." },
    { id: "scheduled-today", subject: "Visio annoncee", author: "Marc", date: old.toISOString(), folder: "Archives", excerpt: `Visioconference prevue le ${targetDate}.` },
  ];
  let providerMessages;
  const context = vm.createContext({
    Date,
    Intl,
    getSettings: async () => ({ chatTopK: 6, lastIndexedAt: new Date().toISOString(), uiLanguage: "fr", externalBriefEnabled: true }),
    countVectors: async () => records.length,
    getAllVectors: async () => records,
    getCalendarEventsBetween: async () => [{
      id: "calendar-today", title: "Point equipe", startDate: today.toISOString(),
      endDate: new Date(today.getTime() + 60 * 60 * 1000).toISOString(), calendarName: "INRAE",
    }],
    fetchExternalBrief: async () => ({
      weather: { location: "Bordeaux", sourceUrl: "https://open-meteo.com/", days: [{ date: targetDate, condition: "pluie", min: 15, max: 22, rainProbability: 70 }] },
      news: [{ title: "Une actualite importante", domain: "example.test", date: targetDate, url: "https://example.test/news" }],
    }),
    callProviderChat: async (_settings, messages) => {
      providerMessages = messages;
      return "- Budget valide [Mail 1].\n- Visio aujourd'hui [Mail 2].\n- Point equipe [Calendrier 1].\n- Il pleut [Meteo 1].\n- Le monde persiste [Actualite 1].";
    },
  });
  vm.runInContext(readFileSync(join(__dirname, "..", "background", "chatService.js"), "utf8"), context);

  const result = await vm.runInContext('answerMailboxQuestion("Quoi de neuf ?")', context);

  assert.match(providerMessages.at(-1).content, /Visio annoncee/);
  assert.match(providerMessages.at(-1).content, /CALENDRIER/);
  assert.match(providerMessages.at(-1).content, /ACTUALITES EXTERNES/);
  assert.deepEqual(Array.from(result.sources, (source) => source.type || "mail"), ["mail", "mail", "calendar", "external", "external"]);
  assert.doesNotMatch(result.answer, /\[(?:Mail|Calendrier|Meteo|Actualite)/);
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
