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
