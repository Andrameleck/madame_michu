const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = vm.createContext({});
vm.runInContext(
  readFileSync(join(__dirname, "..", "llm", "responseParser.js"), "utf8"),
  context
);

function parse(value) {
  context.input = value;
  return vm.runInContext("parseLlmResponse(input)", context);
}

test("accepte une reponse JSON entouree d'un bloc Markdown", () => {
  const result = parse(`Texte parasite\n\`\`\`json
  {"summary":"**Urgent**","events":[]}
  \`\`\``);
  assert.equal(result.summary, "**Urgent**");
  assert.deepEqual(Array.from(result.events), []);
});

test("normalise le resume structure en quatre categories", () => {
  const result = parse(JSON.stringify({
    summary: {
      overview: "Journee centree sur le budget.",
      urgent: [{
        senderName: "Alice Martin",
        action: "Valider le budget",
        need: "Accord avant midi",
        text: "**Valider** le budget avant midi.",
        sourceEmailIds: ["account:budget@example.test", "account:budget@example.test"],
      }],
      important: [{
        text: "Preparer le comite de vendredi.",
        sourceEmailIds: ["account:comite@example.test"],
      }],
      info: ["Le rapport mensuel est disponible. [Mail 3]"],
      other: [],
    },
    events: [],
  }));

  assert.equal(result.summarySections.overview, "Journee centree sur le budget.");
  assert.deepEqual(JSON.parse(JSON.stringify(result.summarySections.urgent)), [
    {
      senderName: "Alice Martin",
      action: "Valider le budget",
      need: "Accord avant midi",
      text: "**Valider** le budget avant midi.",
      sourceEmailIds: ["account:budget@example.test"],
    },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.summarySections.info)), [{
    senderName: "",
    action: "",
    need: "",
    text: "Le rapport mensuel est disponible. [Mail 3]",
    sourceEmailIds: [],
  }]);
  assert.deepEqual(Array.from(result.summarySections.other), []);
  assert.match(result.summary, /## Urgent/);
  assert.match(result.summary, /## Info/);
});

test("garde les identifiants pour les boutons mais les retire du texte visible", () => {
  const result = parse(JSON.stringify({
    summary: {
      overview: "Deux sujets importants. Source: account1:overview@internal.invalid:mail",
      urgent: [],
      important: [{
        senderName: "Project Forge",
        action: "Conserver le projet",
        need: "Avant septembre",
        text: "Le projet sera supprime. Source: account1:6a8a9945570d_3077c1@forge.example.org:mail, account1:6a8c0a2e5dce3_3077c1@forge.example.org:mail",
        sourceEmailIds: ["account1:6a8a9945570d_3077c1@forge.example.org:mail"],
      }],
      info: [], other: [],
    },
    events: [],
  }));
  assert.equal(result.summarySections.overview, "Deux sujets importants.");
  assert.equal(result.summarySections.important[0].text, "Le projet sera supprime.");
  assert.equal(result.summarySections.important[0].sourceEmailIds.length, 1);
});

test("rejette silencieusement les rendez-vous aux dates ou heures impossibles", () => {
  const result = parse(JSON.stringify({
    summary: "RAS",
    events: [
      { title: "Date impossible", date: "2026-02-30", startTime: "10:00" },
      { title: "Heure impossible", date: "2026-08-21", startTime: "29:00" },
      { title: "Fin avant debut", date: "2026-08-21", startTime: "10:00", endTime: "09:00" },
      { title: "Valide", date: "2026-08-21", startTime: "09:30", endTime: "10:00", confidence: "haute" },
    ],
  }));
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, "Valide");
});

test("signale un JSON inutilisable", () => {
  assert.throws(() => parse("pas du json"), /JSON invalide/);
});
