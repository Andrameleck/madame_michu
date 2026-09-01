// Le modele est faillible : il invente des identifiants, oublie des champs,
// entoure son JSON de bavardage. Ces tests figent ce que l'application accepte
// et ce qu'elle corrige avant d'afficher quoi que ce soit.

import assert from "node:assert/strict";
import test from "node:test";

import { groupByImportance, normalizeReport } from "../../src/features/reports/schema.js";
import { normalizeDetections } from "../../src/features/events/service.js";
import { extractJsonObject, parseEmulatedResponse } from "../../src/llm/toolEmulation.js";
import { collapseWhitespace, stripQuotedText, truncate } from "../../src/mail/text.js";

test("un rapport garde les entrees exploitables et corrige le reste", () => {
  const report = normalizeReport({
    overview: "  Deux   choses  a traiter. ",
    entries: [
      { subject: "Facture", sender: "Compta", importance: "urgent", summary: "A payer", messageIds: ["1"] },
      { subject: "Pub", sender: "Ads", importance: "n'importe quoi", summary: "Promo", messageIds: ["2"] },
      { subject: "Fantome", sender: "X", importance: "info", summary: "?", messageIds: ["999"] },
    ],
  }, new Set(["1", "2"]));

  assert.equal(report.overview, "Deux choses a traiter.");
  assert.equal(report.entries[0].importance, "urgent", "les urgences remontent en tete");
  assert.equal(report.entries[1].importance, "info", "un niveau inconnu retombe sur info");
  // Un identifiant absent du corpus produirait un lien mort dans l'interface.
  assert.deepEqual(report.entries.at(-1).messageIds, []);
});

test("un evenement sans date valide n'atteint jamais l'agenda", () => {
  const report = normalizeReport({
    overview: "",
    entries: [],
    events: [
      { title: "Reunion", date: "2026-03-04", startTime: "14:00", confidence: "haute", messageId: "1" },
      { title: "Flou", date: "la semaine prochaine", confidence: "haute", messageId: "1" },
      { title: "Sans titre", date: "2026-03-05", confidence: "haute", messageId: "1" },
    ],
  });
  assert.equal(report.events.length, 2);
  assert.equal(report.events[0].startTime, "14:00");
  assert.equal(report.events[1].startTime, "", "une heure absente reste vide, pas inventee");
});

test("le seuil de confiance et le caractere personnel filtrent les detections", () => {
  const detections = normalizeDetections([
    { title: "Point equipe", date: "2026-03-04", confidence: "haute", messageId: "1", concernsUser: true },
    { title: "Webinaire", date: "2026-03-05", confidence: "basse", messageId: "1", concernsUser: true },
    { title: "Reunion des autres", date: "2026-03-06", confidence: "haute", messageId: "1", concernsUser: false },
    { title: "Heure invalide", date: "2026-03-07", startTime: "25:00", confidence: "moyenne", messageId: "1", concernsUser: true },
  ], new Set(["1"]), "moyenne");

  assert.deepEqual(detections.map((event) => event.title), ["Point equipe", "Heure invalide"]);
  assert.equal(detections[1].startTime, "");
});

test("le regroupement par importance couvre tous les niveaux", () => {
  const groups = groupByImportance([{ importance: "urgent" }, { importance: "info" }]);
  assert.deepEqual(Object.keys(groups), ["urgent", "important", "info", "autre"]);
  assert.equal(groups.urgent.length, 1);
  assert.equal(groups.important.length, 0);
});

test("le JSON du protocole emule survit au bavardage et aux blocs de code", () => {
  assert.deepEqual(
    extractJsonObject('Bien sur !\n```json\n{"action":"answer","content":"ok"}\n```\nVoila.'),
    { action: "answer", content: "ok" }
  );
  // Une accolade dans une valeur textuelle casserait une extraction naive.
  assert.deepEqual(
    extractJsonObject('{"action":"answer","content":"il a dit { et } puis \\" fin"}'),
    { action: "answer", content: 'il a dit { et } puis " fin' }
  );
  assert.equal(extractJsonObject("aucun json ici"), null);
});

test("une reponse emulee hors protocole reste utilisable", () => {
  const tools = [{ name: "search_mail" }];
  const answer = parseEmulatedResponse({ text: "Je n'ai rien trouve.", toolCalls: [] }, tools);
  assert.equal(answer.text, "Je n'ai rien trouve.");
  assert.equal(answer.finishReason, "stop");

  // Un outil inexistant ne doit pas devenir un appel : le texte fait foi.
  const invented = parseEmulatedResponse(
    { text: '{"action":"tool","tool":"supprime_tout","arguments":{}}', toolCalls: [] },
    tools
  );
  assert.deepEqual(invented.toolCalls, []);
});

test("le nettoyage des mails coupe citations et signature", () => {
  const raw = [
    "Bonjour,",
    "Peux-tu valider le devis ?",
    "--",
    "Jean Dupont, directeur",
    "> ancien message",
  ].join("\n");
  assert.equal(stripQuotedText(raw), "Bonjour,\nPeux-tu valider le devis ?");

  // Un message entierement cite ne doit pas se reduire a du vide.
  assert.match(stripQuotedText("> tout est cite"), /tout est cite/);
  assert.equal(collapseWhitespace("a  b\n\n\n\nc"), "a b\n\nc");
  assert.match(truncate("mot ".repeat(50), 20), /\[\.\.\. message tronque \.\.\.\]$/);
});
