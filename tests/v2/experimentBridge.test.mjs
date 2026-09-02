// Pont calendrier privilegie. Il ne peut pas etre execute hors de Thunderbird,
// mais ses conditions de chargement sont verifiables — et ce sont elles qui ont
// casse : un import de tete en echec empechait la classe d'exister, et
// Thunderbird ne rapportait qu'un « module is not a constructor » muet.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BRIDGE = "experiments/assistantCalendar/api.js";
const source = readFileSync(join(ROOT, BRIDGE), "utf8");
const schema = JSON.parse(readFileSync(join(ROOT, "experiments/assistantCalendar/schema.json"), "utf8"));

test("le pont est syntaxiquement valide", () => {
  const result = spawnSync(process.execPath, ["--check", join(ROOT, BRIDGE)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("la classe est exposee par var, seule forme vue par le chargeur", () => {
  assert.match(source, /^var assistantCalendar = class extends /m);
  // `let` ou `const` definissent la classe dans une portee que le chargeur de
  // scripts privilegies n'inspecte pas.
  assert.doesNotMatch(source, /^(let|const) assistantCalendar\b/m);
});

test("aucun module de l'agenda n'est importe au chargement", () => {
  // Sans indentation : ce qui s'execute a l'evaluation du script, par
  // opposition aux imports places dans une fonction.
  const topLevelImports = source
    .split("\n")
    .filter((line) => /^(const|let|var)\s.*ChromeUtils\.importESModule/.test(line));
  assert.deepEqual(
    topLevelImports,
    [],
    "un import de tete qui echoue empeche la classe d'etre definie ; "
      + "les modules doivent etre resolus a la demande"
  );
  assert.match(source, /function calendarApi\(\)/, "la resolution doit etre paresseuse");
});

test("un echec de resolution produit un message qui nomme la cause", () => {
  assert.match(source, /Le module Agenda de Thunderbird est introuvable/);
  // Sans repli, une base d'API absente empecherait la classe d'exister.
  assert.match(source, /resolveExtensionApiBase\(\)\s*\n?\s*\|\|/);
});

test("chaque fonction declaree au schema est implementee", () => {
  const declared = schema[0].functions.map((entry) => entry.name);
  for (const name of declared) {
    assert.match(
      source,
      new RegExp(`\\basync ${name}\\s*\\(`),
      `${name} est declaree au schema mais absente de l'implementation`
    );
  }
  assert.ok(declared.includes("listCalendars") && declared.includes("createEvent"));
});

test("l'ecriture reste refusee sur un calendrier non modifiable", () => {
  // Le garde-fou cote pont est la derniere barriere : la couche haute verifie
  // deja, mais elle pourrait etre contournee par un appel direct.
  assert.match(source, /calendar\.readOnly \|\| calendar\.getProperty\("disabled"\)/);
  assert.match(source, /assertWritable\(calendar\)/);
});
