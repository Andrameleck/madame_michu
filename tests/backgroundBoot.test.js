const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = join(__dirname, "..");

// IndexedDB minimal et vide : sans lui, openVectorDb() attend indefiniment un
// evenement onsuccess qui n'arrive jamais.
function fakeIndexedDb() {
  const later = (fn) => setTimeout(fn, 0);
  const request = (compute) => {
    const req = {};
    later(() => {
      req.result = compute();
      req.onsuccess?.();
    });
    return req;
  };
  const store = {
    getAll: () => request(() => []),
    getAllKeys: () => request(() => []),
    count: () => request(() => 0),
    put() {},
    clear() {},
  };
  const db = {
    objectStoreNames: { contains: () => false },
    createObjectStore: () => store,
    transaction: () => ({ objectStore: () => store }),
  };
  return {
    open() {
      const req = { result: db, transaction: { objectStore: () => store } };
      later(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

// Un script du background qui echoue au chargement empeche l'enregistrement de
// messenger.runtime.onMessage. Thunderbird ne signale alors rien cote background :
// c'est la sidebar qui echoue, avec "Could not establish connection. Receiving end
// does not exist." Ce test charge la vraie liste du manifeste, dans son ordre.
function bootBackground() {
  const scripts = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).background.scripts;
  const stored = {};
  const handlers = {};
  const listener = (name) => ({ addListener: (fn) => { handlers[name] = fn; } });

  const messenger = {
    runtime: {
      onInstalled: listener("onInstalled"),
      onStartup: listener("onStartup"),
      onMessage: listener("onMessage"),
    },
    alarms: { onAlarm: listener("onAlarm"), create: async () => {}, clear: async () => {} },
    action: { onClicked: listener("onClicked") },
    tabs: { onUpdated: listener("onUpdated"), create: async () => {} },
    storage: {
      local: {
        get: async (defaults) => Object.fromEntries(
          Object.entries(defaults).map(([key, value]) => [key, key in stored ? stored[key] : value])
        ),
        set: async (partial) => Object.assign(stored, partial),
      },
      onChanged: listener("onChanged"),
    },
    notifications: { create: async () => {} },
    folders: {
      query: async () => [
        { id: "inbox", accountId: "a1", name: "Inbox", path: "/Inbox", specialUse: ["inbox"] },
      ],
    },
    messages: {
      query: async () => ({
        messages: [{ id: 1, headerMessageId: "m@x", author: "A", subject: "S", date: new Date() }],
      }),
      continueList: async () => null,
      getFull: async () => ({ contentType: "text/plain", body: "Bonjour" }),
    },
    messageDisplay: {},
    assistantCalendar: { listCalendars: async () => [] },
  };

  const summaryJson = JSON.stringify({
    summary: { overview: "Rien de neuf.", urgent: [], important: [], info: [], other: [] },
    events: [],
  });
  const context = vm.createContext({
    messenger,
    console: { debug() {}, info() {}, warn() {}, error() {} },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: summaryJson } }),
    }),
    indexedDB: fakeIndexedDb(),
    DOMParser: class {},
    setTimeout,
    clearTimeout,
    crypto: require("node:crypto").webcrypto,
    TextEncoder,
    AbortController,
    URL,
    URLSearchParams,
    btoa,
    Date,
    Intl,
  });

  for (const script of scripts) {
    vm.runInContext(readFileSync(join(root, script), "utf8"), context, { filename: script });
  }
  return { handlers, stored };
}

test("charge tous les scripts du manifeste et enregistre ses listeners", () => {
  const { handlers } = bootBackground();

  for (const name of ["onInstalled", "onStartup", "onAlarm", "onClicked", "onUpdated", "onMessage"]) {
    assert.equal(typeof handlers[name], "function", `listener ${name} non enregistre`);
  }
});

test("repond aux messages de la sidebar au lieu de fermer le canal", async () => {
  const { handlers } = bootBackground();

  // Un listener qui renvoie undefined, ou qui leve une exception synchrone,
  // laisse l'emetteur sur "Receiving end does not exist".
  for (const type of ["REGENERATE_SUMMARY", "GET_LAST_SUMMARY", "LIST_CALENDARS", "GET_INDEX_STATUS"]) {
    const returned = handlers.onMessage({ type, range: "day" });
    assert.notEqual(returned, undefined, `${type} n'a produit aucune reponse`);
    await returned;
  }
});

test("ignore un message inconnu sans lever d'exception", () => {
  const { handlers } = bootBackground();

  assert.equal(handlers.onMessage({ type: "TYPE_INCONNU" }), undefined);
  assert.equal(handlers.onMessage(null), undefined);
});
