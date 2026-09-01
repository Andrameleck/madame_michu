// Invariants de l'interface. Ces pages ne sont pas couvertes par un test
// d'execution : ce sont donc leurs points d'ancrage — identifiants, cles de
// traduction, portraits — qui sont verifies, car ce sont eux qui cassent en
// silence lors d'un remaniement.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { LANGUAGES, t } from "../../src/ui/shared/i18n.js";
import { MOODS, selectMood } from "../../src/features/chat/mood.js";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (relativePath) => readFileSync(join(ROOT, relativePath), "utf8");

const PAGES = ["src/ui/sidebar/sidebar.html", "src/ui/options/options.html"];
const SCRIPTS = [
  "src/ui/sidebar/sidebar.js",
  "src/ui/options/options.js",
  "src/ui/shared/dom.js",
  "src/ui/shared/i18n.js",
];

function i18nKeysOf(html) {
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]);
  const attributeKeys = [...html.matchAll(/data-i18n-attr="([^"]+)"/g)]
    .flatMap((match) => match[1].split(","))
    .map((pair) => pair.split(":")[1]?.trim())
    .filter(Boolean);
  return [...keys, ...attributeKeys];
}

test("chaque cle de traduction utilisee dans le balisage existe", () => {
  for (const page of PAGES) {
    for (const key of i18nKeysOf(read(page))) {
      // t() renvoie la cle elle-meme quand elle est absente du dictionnaire.
      assert.notEqual(t(key, "fr"), key, `${page} : cle inconnue « ${key} »`);
    }
  }
});

test("chaque cle utilisee est traduite dans les deux langues", () => {
  const keys = new Set(PAGES.flatMap((page) => i18nKeysOf(read(page))));
  for (const key of keys) {
    for (const language of LANGUAGES) {
      const value = t(key, language);
      assert.notEqual(value, key, `cle « ${key} » absente en ${language}`);
      assert.ok(value.trim().length > 0, `cle « ${key} » vide en ${language}`);
    }
  }
});

test("chaque humeur a son portrait et sa legende", () => {
  for (const mood of MOODS) {
    assert.ok(
      existsSync(join(ROOT, `src/ui/sidebar/portraits/${mood}.png`)),
      `portrait manquant pour l'humeur ${mood}`
    );
    for (const language of LANGUAGES) {
      assert.notEqual(t(`mood.${mood}`, language), `mood.${mood}`, `legende manquante (${language})`);
    }
  }
});

test("l'humeur traduit ce qui s'est reellement passe", () => {
  assert.equal(selectMood({ error: true }), "furieuse");
  assert.equal(selectMood({ exhausted: true, toolCount: 6 }), "epuisee-affaissee");
  // Une question ordinaire ne declenche aucun outil.
  assert.equal(selectMood({ toolCount: 0 }), "exasperee");
  assert.equal(selectMood({ toolCount: 2, sourceCount: 0 }), "epuisee-affaissee");
  assert.equal(selectMood({ toolCount: 1, sourceCount: 2, answer: "C'est peut-etre lundi" }), "soupconneuse");
  assert.equal(selectMood({ toolCount: 4, sourceCount: 6 }), "inspection-penchee");
  assert.equal(selectMood({ toolCount: 1, sourceCount: 1 }), "profil-meprisant");
  // Toute humeur produite doit avoir un portrait declare.
  assert.ok(MOODS.includes(selectMood({ toolCount: 1, sourceCount: 1 })));
});

test("les identifiants attendus par les scripts existent dans le balisage", () => {
  const expected = {
    "src/ui/sidebar/sidebar.html": [
      "statusBar", "summaryTitle", "summaryMeta", "summaryContent", "eventsList", "eventsEmpty",
      "calendarSelect", "chatMessages", "chatActivity", "chatInput", "chatSendBtn", "chatPortrait",
      "chatPortraitMood", "nextEventTitle", "nextEventWhen", "languageFrBtn", "languageEnBtn",
      "optionsBtn", "regenerateBtn", "scanEventsBtn", "chatForm", "newThreadBtn",
    ],
    "src/ui/options/options.html": [
      "providerTabs", "providerEditor", "addProfileBtn", "saveBtn", "saveStatus", "allowRemote",
      "allAccounts", "allFolders", "accountsField", "accountsList", "maxMessages", "maxBodyChars",
      "reportTime", "autoRefresh", "language", "calendarId", "minConfidence", "confirmBeforeWrite",
      "autoCreate", "calendarUnavailable",
    ],
  };
  for (const [page, ids] of Object.entries(expected)) {
    const html = read(page);
    for (const id of ids) {
      assert.ok(html.includes(`id="${id}"`), `${page} : element #${id} manquant`);
    }
  }
});

test("les onglets de periode couvrent les trois rapports", () => {
  const html = read("src/ui/sidebar/sidebar.html");
  for (const range of ["day", "week", "month"]) {
    assert.match(html, new RegExp(`data-range="${range}"`), `onglet ${range} manquant`);
  }
});

test("aucune sortie de modele n'est injectee en HTML", () => {
  for (const script of SCRIPTS) {
    const source = read(script);
    assert.ok(!/\.innerHTML\s*=/.test(source), `${script} : innerHTML interdit`);
    assert.ok(!/insertAdjacentHTML/.test(source), `${script} : insertAdjacentHTML interdit`);
  }
});

test("les feuilles de style conservent l'identite visuelle de Madame Michu", () => {
  for (const stylesheet of ["src/ui/sidebar/sidebar.css", "src/ui/options/options.css"]) {
    const css = read(stylesheet);
    assert.match(css, /--accent: #66733a/, `${stylesheet} : vert sauge perdu`);
    assert.match(css, /--gold: #bd8734/, `${stylesheet} : or perdu`);
    assert.match(css, /Georgia/, `${stylesheet} : titres en serif perdus`);
    assert.match(css, /prefers-color-scheme: dark/, `${stylesheet} : theme sombre perdu`);
  }
});
