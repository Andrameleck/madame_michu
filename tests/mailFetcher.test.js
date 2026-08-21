const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("resout INBOX par specialUse et parcourt toutes les pages", async () => {
  let continuedListId = null;
  const context = vm.createContext({
    Date,
    Set,
    clearTimeout,
    setTimeout,
    logger: { warn() {} },
    collapseWhitespace: (value) => value.trim(),
    truncateText: (value, max) => value.slice(0, max),
    htmlToText: (value) => value,
    messenger: {
      folders: {
        query: async () => [
          {
            id: "inbox",
            accountId: "account-1",
            name: "Courrier entrant",
            path: "/Courrier entrant",
            specialUse: ["inbox"],
          },
        ],
      },
      messages: {
        query: async () => ({ id: "page-2", messages: [{ id: 1, headerMessageId: "one@example.test", author: "A", subject: "Un", date: new Date("2026-08-21T08:00:00Z") }] }),
        continueList: async (id) => {
          continuedListId = id;
          return { messages: [{ id: 2, headerMessageId: "two@example.test", author: "B", subject: "Deux", date: new Date("2026-08-21T09:00:00Z") }] };
        },
        getFull: async (id) => ({ contentType: "text/plain", body: `Corps ${id}` }),
        listAttachments: async (id) => id === 2
          ? [{ name: "buffet.zip", size: 11_000_000, contentDisposition: "attachment" }]
          : [],
      },
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailFetcher.js"), "utf8"),
    context
  );
  context.options = {
    folderNames: ["INBOX"],
    maxEmails: 10,
    maxBodyChars: 100,
    sinceDate: new Date(Date.now() - 60_000),
  };
  const emails = await vm.runInContext("fetchEmails(options)", context);

  assert.equal(continuedListId, "page-2");
  assert.deepEqual(Array.from(emails, (email) => email.id), [
    "account-1:two@example.test",
    "account-1:one@example.test",
  ]);
  assert.equal(emails.diagnostics.matchedFolders[0].name, "Courrier entrant");
  assert.equal(emails[0].attachmentTotalSize, 11_000_000);
  assert.deepEqual(JSON.parse(JSON.stringify(emails[0].attachments)), [
    { name: "buffet.zip", size: 11_000_000 },
  ]);
});

test("exclut les mails avec leur identifiant persistant", async () => {
  let fullMessageReads = 0;
  const context = vm.createContext({
    Date,
    Set,
    clearTimeout,
    setTimeout,
    logger: { warn() {} },
    collapseWhitespace: (value) => value.trim(),
    truncateText: (value, max) => value.slice(0, max),
    htmlToText: (value) => value,
    messenger: {
      folders: {
        query: async () => [{
          id: "inbox",
          accountId: "account-1",
          name: "Courrier entrant",
          path: "/Courrier entrant",
          specialUse: ["inbox"],
        }],
      },
      messages: {
        query: async () => ({
          messages: [
            { id: 42, headerMessageId: "known@example.test", author: "A", subject: "Connu", date: new Date() },
            { id: 43, headerMessageId: "new@example.test", author: "B", subject: "Nouveau", date: new Date() },
          ],
        }),
        getFull: async (id) => {
          fullMessageReads++;
          return { contentType: "text/plain", body: `Corps ${id}` };
        },
      },
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailFetcher.js"), "utf8"),
    context
  );
  context.options = {
    folderNames: ["INBOX"],
    maxEmails: 10,
    maxBodyChars: 100,
    sinceDate: new Date(Date.now() - 60_000),
    excludeIds: new Set(["account-1:known@example.test"]),
  };

  const emails = await vm.runInContext("fetchEmails(options)", context);

  assert.equal(fullMessageReads, 1);
  assert.deepEqual(Array.from(emails, (email) => email.id), ["account-1:new@example.test"]);
});

test("ignore les notifications techniques Exchange avant qu'elles consomment la limite", async () => {
  const fullMessageReads = [];
  const context = vm.createContext({
    Date,
    Set,
    clearTimeout,
    setTimeout,
    logger: { warn() {} },
    collapseWhitespace: (value) => value.trim(),
    truncateText: (value, max) => value.slice(0, max),
    htmlToText: (value) => value,
    messenger: {
      folders: {
        query: async () => [{
          id: "inbox",
          accountId: "account-1",
          name: "Courrier entrant",
          path: "/Courrier entrant",
          specialUse: ["inbox"],
        }],
      },
      messages: {
        query: async () => ({
          messages: [
            {
              id: 1,
              headerMessageId: "failure-1@example.test",
              author: "Microsoft Exchange Server 2010",
              subject: "Retrieval using the IMAP4 protocol failed for the following message: 6",
              date: new Date("2026-08-21T10:00:00Z"),
            },
            {
              id: 2,
              headerMessageId: "useful@example.test",
              author: "Alice",
              subject: "Validation Optirrig",
              date: new Date("2026-08-21T09:00:00Z"),
            },
          ],
        }),
        getFull: async (id) => {
          fullMessageReads.push(id);
          return { contentType: "text/plain", body: `Corps ${id}` };
        },
      },
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailFetcher.js"), "utf8"),
    context
  );
  context.options = {
    folderNames: ["INBOX"],
    maxEmails: 1,
    maxBodyChars: 100,
    sinceDate: new Date("2026-08-20T00:00:00Z"),
  };

  const emails = await vm.runInContext("fetchEmails(options)", context);

  assert.deepEqual(fullMessageReads, [2]);
  assert.equal(emails[0].subject, "Validation Optirrig");
  assert.equal(emails.diagnostics.ignoredTechnicalCount, 1);
});

test("parcourt toutes les pages avant de garder les mails les plus recents", async () => {
  const fullMessageReads = [];
  const context = vm.createContext({
    Date,
    Set,
    clearTimeout,
    setTimeout,
    logger: { warn() {} },
    collapseWhitespace: (value) => value.trim(),
    truncateText: (value, max) => value.slice(0, max),
    htmlToText: (value) => value,
    messenger: {
      folders: {
        query: async () => [{
          id: "inbox",
          accountId: "account-1",
          name: "Courrier entrant",
          path: "/Courrier entrant",
          specialUse: ["inbox"],
        }],
      },
      messages: {
        query: async () => ({
          id: "newer-page",
          messages: [{
            id: 1,
            headerMessageId: "old@example.test",
            author: "A",
            subject: "Hier",
            date: new Date("2026-08-20T08:00:00Z"),
          }],
        }),
        continueList: async () => ({
          messages: [{
            id: 2,
            headerMessageId: "morning@example.test",
            author: "B",
            subject: "Ce matin",
            date: new Date("2026-08-21T08:00:00Z"),
          }],
        }),
        getFull: async (id) => {
          fullMessageReads.push(id);
          return { contentType: "text/plain", body: `Corps ${id}` };
        },
      },
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailFetcher.js"), "utf8"),
    context
  );
  context.options = {
    folderNames: ["INBOX"],
    maxEmails: 1,
    maxBodyChars: 100,
    sinceDate: new Date("2026-08-19T00:00:00Z"),
  };

  const emails = await vm.runInContext("fetchEmails(options)", context);

  assert.deepEqual(fullMessageReads, [2]);
  assert.equal(emails[0].subject, "Ce matin");
  assert.equal(emails.diagnostics.candidateCount, 2);
});

test("le selecteur etoile couvre tous les dossiers de courrier utiles", async () => {
  const context = vm.createContext({
    Date,
    Set,
    clearTimeout,
    setTimeout,
    messenger: {
      folders: {
        query: async () => [
          { id: "inbox", name: "Inbox", path: "/Inbox", specialUse: ["inbox"] },
          { id: "project", name: "Projet", path: "/Projet", specialUse: [] },
          { id: "sent", name: "Envoyes", path: "/Envoyes", specialUse: ["sent"] },
          { id: "trash", name: "Corbeille", path: "/Corbeille", specialUse: ["trash"] },
          { id: "root", name: "Compte", path: "/", isRoot: true, specialUse: [] },
        ],
      },
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailFetcher.js"), "utf8"),
    context
  );

  const folders = await vm.runInContext('listAccountFolders(["*"])', context);

  assert.deepEqual(Array.from(folders, (folder) => folder.id), ["inbox", "project"]);
});

test("ignore un dossier illisible et poursuit avec les autres", async () => {
  const context = vm.createContext({
    Date,
    Set,
    clearTimeout,
    setTimeout,
    logger: { warn() {} },
    collapseWhitespace: (value) => value.trim(),
    truncateText: (value, max) => value.slice(0, max),
    htmlToText: (value) => value,
    messenger: {
      folders: {
        query: async () => [
          { id: "broken", accountId: "account-1", name: "Casse", path: "/Casse" },
          { id: "working", accountId: "account-1", name: "Projet", path: "/Projet" },
        ],
      },
      messages: {
        query: async ({ folderId }) => {
          if (folderId === "broken") throw new Error("Dossier IMAP indisponible");
          return {
            messages: [{
              id: 7,
              headerMessageId: "working@example.test",
              author: "Alice",
              subject: "Projet",
              date: new Date("2026-08-21T09:00:00Z"),
            }],
          };
        },
        getFull: async () => ({ contentType: "text/plain", body: "Information utile" }),
      },
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailFetcher.js"), "utf8"),
    context
  );
  context.options = {
    folderNames: ["*"],
    maxEmails: 10,
    maxBodyChars: 100,
    sinceDate: new Date("2026-08-20T00:00:00Z"),
  };

  const emails = await vm.runInContext("fetchEmails(options)", context);

  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Projet");
  assert.equal(emails.diagnostics.folderErrors.length, 1);
  assert.equal(emails.diagnostics.folderErrors[0].name, "Casse");
});

test("ouvre un mail par son Message-ID persistant", async () => {
  let openProperties = null;
  const context = vm.createContext({
    Date,
    Set,
    clearTimeout,
    setTimeout,
    messenger: {
      messageDisplay: {
        open: async (properties) => {
          openProperties = properties;
          return { id: 7 };
        },
      },
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailFetcher.js"), "utf8"),
    context
  );
  context.source = {
    id: "account-1:mail@example.test",
    messageId: "42",
    headerMessageId: "mail@example.test",
  };

  await vm.runInContext("openMailSource(source)", context);

  assert.equal(openProperties.headerMessageId, "mail@example.test");
  assert.equal(openProperties.location, "tab");
  assert.equal(openProperties.active, true);
});

test("replie l'ouverture sur l'identifiant Thunderbird courant", async () => {
  const attempts = [];
  const context = vm.createContext({
    Date,
    Set,
    clearTimeout,
    setTimeout,
    messenger: {
      messageDisplay: {
        open: async (properties) => {
          attempts.push(properties);
          if (properties.headerMessageId) throw new Error("Message-ID inconnu");
          return { id: 8 };
        },
      },
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailFetcher.js"), "utf8"),
    context
  );
  context.source = {
    id: "account-1:mail@example.test",
    messageId: "42",
    headerMessageId: "mail@example.test",
  };

  await vm.runInContext("openMailSource(source)", context);

  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].messageId, 42);
});

test("inclut la veille dans le resume du jour et calcule les autres periodes", () => {
  const context = vm.createContext({ Date });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailFetcher.js"), "utf8"),
    context
  );
  context.now = new Date(2026, 7, 20, 15, 30);

  assert.equal(
    vm.runInContext('startOfSummaryRange("day", now).toISOString()', context),
    new Date(2026, 7, 19).toISOString()
  );
  assert.equal(
    vm.runInContext('startOfSummaryRange("week", now).toISOString()', context),
    new Date(2026, 7, 17).toISOString()
  );
  assert.equal(
    vm.runInContext('startOfSummaryRange("month", now).toISOString()', context),
    new Date(2026, 7, 1).toISOString()
  );
});

function messagesContext({ headers, getFull }) {
  return vm.createContext({
    Date,
    Set,
    Promise,
    Object,
    Array,
    Infinity,
    setTimeout,
    clearTimeout,
    logger: { warn() {} },
    collapseWhitespace: (value) => value.trim(),
    truncateText: (value, max) => value.slice(0, max),
    htmlToText: (value) => value,
    messenger: {
      folders: {
        query: async () => [{
          id: "inbox",
          accountId: "account-1",
          name: "Courrier entrant",
          path: "/Courrier entrant",
          specialUse: ["inbox"],
        }],
      },
      messages: {
        query: async () => ({ messages: headers }),
        continueList: async () => null,
        getFull,
      },
    },
  });
}

function loadFetcher(context) {
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "mailFetcher.js"), "utf8"),
    context
  );
  return context;
}

function fakeHeaders(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    headerMessageId: `mail-${index + 1}@example.test`,
    author: "A",
    subject: `Sujet ${index + 1}`,
    // Dates decroissantes : l'ordre de tri est donc celui des identifiants.
    date: new Date(Date.UTC(2026, 7, 21, 12) - index * 60_000),
  }));
}

test("lit plusieurs corps de mails en parallele", async () => {
  let concurrent = 0;
  let peak = 0;
  const context = loadFetcher(messagesContext({
    headers: fakeHeaders(12),
    getFull: async (id) => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent--;
      return { contentType: "text/plain", body: `Corps ${id}` };
    },
  }));
  context.options = {
    folderNames: ["INBOX"],
    maxEmails: 12,
    maxBodyChars: 100,
    sinceDate: new Date("2026-08-19T00:00:00Z"),
  };

  const emails = await vm.runInContext("fetchEmails(options)", context);

  assert.equal(emails.length, 12);
  assert.ok(peak > 1, `les lectures sont restees serielles (pic ${peak})`);
  // Le tri par date decroissante survit a la lecture parallele.
  assert.deepEqual(Array.from(emails, (email) => email.messageId), fakeHeaders(12).map(
    (header) => String(header.id)
  ));
});

test("compense les corps illisibles avec les candidats suivants", async () => {
  const context = loadFetcher(messagesContext({
    headers: fakeHeaders(5),
    getFull: async (id) => {
      if (id <= 2) throw new Error("Corps illisible");
      return { contentType: "text/plain", body: `Corps ${id}` };
    },
  }));
  context.options = {
    folderNames: ["INBOX"],
    maxEmails: 3,
    maxBodyChars: 100,
    sinceDate: new Date("2026-08-19T00:00:00Z"),
  };

  const emails = await vm.runInContext("fetchEmails(options)", context);

  assert.deepEqual(Array.from(emails, (email) => email.messageId), ["3", "4", "5"]);
});
