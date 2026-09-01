// Le manifeste est la seule declaration que Thunderbird lit avant de charger
// quoi que ce soit : une reference cassee ne se voit qu'a l'installation. Ce
// test verifie chaque chemin et les invariants du socle ES modules.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.next.json"), "utf8"));

function exists(relativePath) {
  return existsSync(join(ROOT, relativePath));
}

test("le background est un module unique, sans ordre de chargement", () => {
  assert.equal(manifest.background.type, "module", "les imports ESM exigent type: module");
  assert.deepEqual(manifest.background.scripts, ["src/background/index.js"]);
  assert.ok(exists(manifest.background.scripts[0]));
  // Thunderbird 128 est base sur Firefox ESR 128 ; background.type est
  // supporte depuis Firefox 112.
  assert.ok(Number(manifest.browser_specific_settings.gecko.strict_min_version.split(".")[0]) >= 112);
});

test("tous les fichiers references existent", () => {
  const referenced = [
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.experiment_apis.assistantCalendar.schema,
    manifest.experiment_apis.assistantCalendar.parent.script,
  ];
  for (const path of referenced) {
    assert.ok(exists(path), `fichier manquant : ${path}`);
  }
  // La page ouverte par le bouton d'action n'apparait pas dans le manifeste :
  // elle est resolue a l'execution, donc verifiee ici explicitement.
  assert.ok(exists("src/ui/sidebar/sidebar.html"));
});

test("les permissions se limitent a ce que la version 2 utilise", () => {
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["accountsRead", "alarms", "messagesRead", "storage", "tabs"]
  );
  // Les services distants passent par optional_host_permissions, demandes a
  // l'utilisateur au moment ou il configure un profil.
  for (const origin of manifest.host_permissions) {
    assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])\/\*$/);
  }
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
});

test("les pages d'interface chargent leurs scripts en module", () => {
  for (const page of ["src/ui/options/options.html", "src/ui/sidebar/sidebar.html"]) {
    const html = readFileSync(join(ROOT, page), "utf8");
    assert.match(html, /<script type="module" src="[^"]+"><\/script>/, `${page} : script non-module`);
    // Les MailExtensions interdisent le script en ligne : la CSP le bloquerait.
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/, `${page} : script en ligne interdit`);
  }
});
