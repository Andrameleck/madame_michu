const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "background", "newsService.js"), "utf8");

test("lit et filtre le flux Atom sans utiliser le LLM ni les mails", async () => {
  const stored = {};
  let fetchCount = 0;
  const xml = `<?xml version="1.0"?><feed><title>The Conversation</title>
    <entry><title>Une étude sur le climat</title><link href="https://theconversation.com/fr/climat-1"/><published>2026-08-25T10:00:00Z</published><category term="Environnement"/></entry>
    <entry><title>Une exposition artistique</title><link href="https://theconversation.com/fr/art-2"/><published>2026-08-25T09:00:00Z</published><category term="Culture"/></entry>
  </feed>`;
  const context = vm.createContext({
    Date, URL, AbortController, setTimeout, clearTimeout,
    getSettings: async () => ({ newsTopics: ["environment"] }),
    messenger: { permissions: { contains: async () => true }, storage: { local: {
      get: async (defaults) => ({ ...defaults, ...stored }),
      set: async (values) => Object.assign(stored, values),
    } } },
    fetch: async () => { fetchCount += 1; return { ok: true, text: async () => xml }; },
  });
  vm.runInContext(source, context);
  const result = await vm.runInContext("refreshNewsFlash()", context);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Une étude sur le climat");
  assert.equal(result.items[0].source, "The Conversation");
  await vm.runInContext("refreshNewsFlash()", context);
  assert.equal(fetchCount, 1, "le second appel doit utiliser le cache de cinq minutes");
  assert.doesNotMatch(source, /callProvider|mailFetcher|summarySections/);
});

test("explique clairement une permission de flux manquante", async () => {
  const context = vm.createContext({
    Date, URL, AbortController, setTimeout, clearTimeout,
    getSettings: async () => ({ newsFeedUrl: "https://journal.test/rss.xml", newsTopics: [] }),
    messenger: {
      permissions: { contains: async () => false },
      storage: { local: { get: async () => ({ lastNewsFlash: null }), set: async () => {} } },
    },
    fetch: async () => { throw new Error("ne doit pas etre appele"); },
  });
  vm.runInContext(source, context);
  await assert.rejects(vm.runInContext("refreshNewsFlash()", context), /Enregistre de nouveau les options/);
});

test("accepte aussi un canal RSS classique et son nom", () => {
  const context = vm.createContext({ Date, URL, AbortController, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  context.xml = `<rss><channel><title>Journal libre</title><item><title>Une actualité</title><link>https://journal.test/article</link><pubDate>Tue, 25 Aug 2026 10:00:00 GMT</pubDate><category>Société</category></item></channel></rss>`;
  const parsed = vm.runInContext('parseNewsFeed(xml, "https://journal.test/rss.xml")', context);
  assert.equal(parsed[0].source, "Journal libre");
  assert.equal(parsed[0].title, "Une actualité");
  assert.equal(parsed[0].url, "https://journal.test/article");
});

test("ne montre pas un article hors des themes choisis", () => {
  const context = vm.createContext({ Date, AbortController, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  context.items = [{ title: "Titre général", categories: [], url: "https://example.test" }];
  assert.equal(vm.runInContext('filterNewsByTopics(items, ["science"]).length', context), 0);
});
