const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// IndexedDB minimal : suffisant pour les quelques operations utilisees par le
// vector store, et instrumente pour compter les lectures completes du store.
function fakeIndexedDb(initialRecords = []) {
  const data = new Map(initialRecords.map((record) => [record.id, record]));
  const stats = { fullReads: 0 };
  const later = (fn) => setTimeout(fn, 0);
  const request = (compute) => {
    const req = {};
    later(() => {
      req.result = compute();
      req.onsuccess?.();
    });
    return req;
  };

  const db = {
    objectStoreNames: { contains: () => false },
    createObjectStore: () => {},
    transaction() {
      const tx = {};
      const store = {
        put(record) {
          data.set(record.id, record);
          later(() => tx.oncomplete?.());
        },
        clear() {
          data.clear();
          later(() => tx.oncomplete?.());
        },
        getAll: () => request(() => {
          stats.fullReads++;
          return [...data.values()];
        }),
        getAllKeys: () => request(() => [...data.keys()]),
        count: () => request(() => data.size),
      };
      tx.objectStore = () => store;
      return tx;
    },
  };

  return {
    stats,
    indexedDB: {
      open() {
        const req = { result: db, transaction: { objectStore: () => ({ clear() {} }) } };
        later(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req;
      },
    },
  };
}

function mail(id, subject, excerpt, embedding = null) {
  return { id, subject, author: "Alice", excerpt, date: "2026-08-20T08:00:00.000Z", embedding };
}

function loadStore(records) {
  const { indexedDB, stats } = fakeIndexedDb(records);
  const context = vm.createContext({ indexedDB, setTimeout, Math });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "llm", "vectorStore.js"), "utf8"),
    context
  );
  return { context, stats };
}

test("ne confond plus un terme avec un mot qui le contient seulement", async () => {
  const { context } = loadStore([mail("1", "Article de blog", "Rien a signaler ici.")]);
  context.question = "art";
  const matches = await vm.runInContext("searchLexical(question, 5)", context);
  assert.equal(matches.length, 0);
});

test("retrouve un mail malgre une flexion du terme recherche", async () => {
  const { context } = loadStore([
    mail("1", "Contrats signes", "Les deux contrats sont signes."),
    mail("2", "Cantine", "Le menu de la semaine."),
  ]);
  context.question = "contrat";
  const matches = await vm.runInContext("searchLexical(question, 5)", context);
  assert.deepEqual(Array.from(matches, (match) => match.record.id), ["1"]);
  assert.ok(matches[0].score > 0);
});

test("classe avant un mail dont l'objet contient exactement le terme", async () => {
  const { context } = loadStore([
    mail("corps", "Divers", "Le budget a ete valide."),
    mail("objet", "Budget 2026", "Reunion prevue."),
  ]);
  context.question = "budget";
  const matches = await vm.runInContext("searchLexical(question, 5)", context);
  assert.deepEqual(Array.from(matches, (match) => match.record.id), ["objet", "corps"]);
});

test("ne relit pas IndexedDB a chaque recherche", async () => {
  const { context, stats } = loadStore([mail("1", "Budget", "Budget valide.")]);
  context.question = "budget";
  await vm.runInContext("searchLexical(question, 5)", context);
  await vm.runInContext("searchLexical(question, 5)", context);
  await vm.runInContext("getAllVectors()", context);
  assert.equal(stats.fullReads, 1);
});

test("prend en compte un mail indexe apres le premier chargement", async () => {
  const { context } = loadStore([mail("1", "Budget", "Budget valide.")]);
  context.question = "reunion";
  assert.equal((await vm.runInContext("searchLexical(question, 5)", context)).length, 0);

  context.nouveau = mail("2", "Reunion", "Reunion lundi.");
  await vm.runInContext("upsertVector(nouveau)", context);
  const matches = await vm.runInContext("searchLexical(question, 5)", context);
  assert.deepEqual(Array.from(matches, (match) => match.record.id), ["2"]);
});

test("oublie l'index en memoire quand le store est vide", async () => {
  const { context } = loadStore([mail("1", "Budget", "Budget valide.")]);
  context.question = "budget";
  assert.equal((await vm.runInContext("searchLexical(question, 5)", context)).length, 1);
  await vm.runInContext("clearVectors()", context);
  assert.equal((await vm.runInContext("searchLexical(question, 5)", context)).length, 0);
});

test("classe les mails par similarite cosinus et ignore ceux sans vecteur", async () => {
  const { context } = loadStore([
    mail("oppose", "A", "a", [-1, 0]),
    mail("proche", "B", "b", [10, 0]),
    mail("lexical", "C", "c", null),
    mail("perpendiculaire", "D", "d", [0, 3]),
  ]);
  context.query = [1, 0];
  const matches = await vm.runInContext("searchSimilar(query, 10)", context);
  assert.deepEqual(Array.from(matches, (match) => match.record.id), [
    "proche",
    "perpendiculaire",
    "oppose",
  ]);
  assert.ok(Math.abs(matches[0].score - 1) < 1e-6);
});

test("ne retourne rien pour un vecteur de requete inexploitable", async () => {
  const { context } = loadStore([mail("1", "A", "a", [1, 0])]);
  assert.equal((await vm.runInContext("searchSimilar([0, 0], 5)", context)).length, 0);
  assert.equal((await vm.runInContext("searchSimilar(null, 5)", context)).length, 0);
});
