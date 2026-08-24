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
    attachments: [{ name: "budget-final.pdf", size: 12_000_000 }],
    attachmentTotalSize: 12_000_000,
  }];

  context.period = {
    rangeLabel: "la semaine en cours",
    rangeStart: "2026-08-17T00:00:00.000Z",
    rangeEnd: "2026-08-20T12:00:00.000Z",
    calendarEvents: [{
      id: "event-1",
      sourceId: "inrae:event-1:2026-08-21T09:00:00.000Z",
      calendarName: "INRAE",
      title: "Comite Optirrig",
      startDate: "2026-08-21T09:00:00.000Z",
      endDate: "2026-08-21T10:00:00.000Z",
      location: "Salle A",
    }],
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
  assert.match(prompt.system, /Raisonne par SUJET, PROJET ou EVENEMENT/);
  assert.match(prompt.system, /UNE SEULE puce/);
  assert.match(prompt.system, /les prospectus/);
  assert.match(prompt.system, /buffet entier par courrier/);
  assert.match(prompt.system, /au maximum UNE dans tout le rapport/);
  assert.match(prompt.system, /On aura tout vu/);
  assert.match(prompt.system, /takes the biscuit/);
  assert.match(prompt.system, /nombre de\s+sujets distincts, pas le nombre de mails/);
  assert.match(prompt.system, /deja enregistres dans Thunderbird/);
  assert.match(prompt.system, /Ne recopie JAMAIS un evenement deja enregistre/);
  assert.match(prompt.system, /"sourceEmailIds": \[\]/);
  assert.match(prompt.user, /Budget du projet/);
  assert.match(prompt.user, /la semaine en cours/);
  assert.match(prompt.user, /2026-08-17/);
  assert.match(prompt.user, /AGENDA THUNDERBIRD DEJA ENREGISTRE/);
  assert.match(prompt.user, /Comite Optirrig/);
  assert.match(prompt.user, /calendrier: INRAE/);
  assert.match(prompt.user, /fil normalise: Budget du projet/);
  assert.match(prompt.user, /budget-final\.pdf \(12000000 octets\)/);
});

test("normalise les prefixes de reponse pour aider au regroupement d'un fil", () => {
  context.subject = "Re: TR: [Projet] Presentation Optirrig";
  assert.equal(
    vm.runInContext("normalizeThreadSubject(subject)", context),
    "Presentation Optirrig"
  );
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

test("impose un anglais britannique lorsque la langue anglaise est choisie", () => {
  context.period = { language: "en" };
  const prompt = vm.runInContext("buildPrompt([], period)", context);
  assert.match(prompt.system, /British English/);
  assert.match(prompt.system, /British spelling and idiom/);
  assert.match(prompt.system, /never American English/);
  assert.match(prompt.system, /organise/);
});
