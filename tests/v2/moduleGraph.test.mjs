// Remplace l'ancien test de demarrage : il ne s'agit plus de verifier un ordre
// de chargement, mais que le graphe d'imports se resout et que chaque module
// expose ce que ses consommateurs attendent.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const ROOT = new URL("../../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".js") ? [full] : [];
  });
}

// Les points d'entree s'executent au chargement : le background branche des
// listeners, les pages d'interface touchent le DOM. Ils sont verifies par une
// analyse syntaxique plutot que par une importation.
const ENTRY_POINTS = new Set([
  "background/index.js",
  "ui/options/options.js",
  "ui/sidebar/sidebar.js",
]);

const allFiles = walk(ROOT);
const relativeName = (file) => relative(ROOT, file).replace(/\\/g, "/");
const modules = allFiles.filter((file) => !ENTRY_POINTS.has(relativeName(file)));

test("tous les modules s'importent sans dependance manquante", async () => {
  assert.ok(modules.length > 15, "le graphe devrait contenir tous les modules de src/");
  for (const file of modules) {
    await import(pathToFileURL(file).href);
  }
});

test("les points d'entree sont syntaxiquement valides", () => {
  const found = allFiles.map(relativeName).filter((name) => ENTRY_POINTS.has(name));
  assert.deepEqual(found.sort(), [...ENTRY_POINTS].sort(), "un point d'entree a disparu ou change de nom");
  for (const file of allFiles) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relativeName(file)} : ${result.stderr}`);
  }
});

test("les modules cles exposent leur contrat", async () => {
  const gateway = await import("../../src/llm/gateway.js");
  for (const name of ["chat", "chatJson", "listModels", "testProfile", "callProfile"]) {
    assert.equal(typeof gateway[name], "function", `gateway.${name} manquant`);
  }

  const registry = await import("../../src/llm/registry.js");
  assert.deepEqual(registry.PROVIDER_IDS, ["ollama", "openai", "anthropic", "chatgpt"]);
  for (const descriptor of registry.describeProviders()) {
    assert.ok(descriptor.label && descriptor.description, `${descriptor.id} mal decrit`);
    assert.ok(descriptor.fields.length, `${descriptor.id} n'a aucun champ de configuration`);
    assert.ok(["none", "api-key", "oauth"].includes(descriptor.auth));
    // La description publique ne doit jamais transporter l'adaptateur.
    assert.equal(descriptor.adapter, undefined);
  }

  const operations = (await import("../../src/background/operations.js")).operations;
  for (const [name, handler] of Object.entries(operations)) {
    assert.equal(typeof handler, "function", `operation ${name} invalide`);
  }
  assert.ok(Object.keys(operations).length >= 20);
});

test("chaque fournisseur declare un adaptateur complet", async () => {
  const { PROVIDERS } = await import("../../src/llm/registry.js");
  for (const [id, descriptor] of Object.entries(PROVIDERS)) {
    assert.equal(typeof descriptor.adapter.chat, "function", `${id}.chat manquant`);
    assert.equal(typeof descriptor.adapter.listModels, "function", `${id}.listModels manquant`);
  }
});

test("les outils du modele ont des schemas exploitables", async () => {
  const { mailTools } = await import("../../src/agent/tools/mailTools.js");
  const { calendarTools } = await import("../../src/agent/tools/calendarTools.js");
  for (const tool of [...mailTools, ...calendarTools]) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
    assert.ok(tool.description.length > 40, `${tool.name} : description trop pauvre pour un modele`);
    assert.equal(tool.parameters.type, "object");
    assert.equal(typeof tool.handler, "function");
    for (const [key, spec] of Object.entries(tool.parameters.properties)) {
      assert.ok(spec.description, `${tool.name}.${key} sans description`);
    }
  }
});
