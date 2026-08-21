const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = vm.createContext({ Date });
vm.runInContext(
  readFileSync(join(__dirname, "..", "llm", "promptBuilder.js"), "utf8"),
  context
);

test("demande un resume detaille, structure et proportionnel au volume", () => {
  context.emails = [{
    id: "message@example.test",
    author: "Alice",
    subject: "Budget du projet",
    date: "2026-08-20T08:00:00.000Z",
    bodyText: "Merci de valider le budget avant vendredi.",
  }];

  context.period = {
    rangeLabel: "la semaine en cours",
    rangeStart: "2026-08-17T00:00:00.000Z",
    rangeEnd: "2026-08-20T12:00:00.000Z",
  };
  const prompt = vm.runInContext("buildPrompt(emails, period)", context);

  assert.match(prompt.system, /"overview"/);
  assert.match(prompt.system, /"urgent"/);
  assert.match(prompt.system, /"important"/);
  assert.match(prompt.system, /"info"/);
  assert.match(prompt.system, /"other"/);
  assert.match(prompt.system, /250 a 600 mots/);
  assert.match(prompt.system, /3 a 5 phrases/);
  assert.match(prompt.system, /exactement une des quatre listes/);
  assert.match(prompt.system, /Optirrig/);
  assert.match(prompt.system, /informations syndicales/);
  assert.match(prompt.system, /derniere minute/);
  assert.match(prompt.system, /signer un papier/);
  assert.match(prompt.system, /"sourceEmailIds"/);
  assert.match(prompt.system, /"senderName"/);
  assert.match(prompt.system, /"action"/);
  assert.match(prompt.system, /"need"/);
  assert.match(prompt.system, /identifiant exact de chaque mail/);
  assert.match(prompt.user, /Budget du projet/);
  assert.match(prompt.user, /la semaine en cours/);
  assert.match(prompt.user, /2026-08-17/);
});

test("date le prompt au moment de l'appel et non au chargement du script", () => {
  const gele = vm.runInContext(
    'buildSystemPrompt(new Date(2030, 0, 2, 12, 0, 0))',
    context
  );
  assert.match(gele, /La date locale actuelle est 2030-01-02\./);

  const aujourdhui = new Date().toLocaleDateString("fr-CA");
  assert.match(
    vm.runInContext("buildPrompt([], {}).system", context),
    new RegExp(`La date locale actuelle est ${aujourdhui}\\.`)
  );
});
