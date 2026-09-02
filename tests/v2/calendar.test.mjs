// Choix du calendrier d'ecriture. Lightning refuse toute ecriture sur un
// calendrier en lecture seule ou desactive ; l'erreur qu'il renvoie ne dit pas
// quel reglage est fautif. Ces tests figent le fait qu'on refuse en amont, avec
// un message qui nomme le calendrier et propose une issue.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { isWritable, resolveTargetCalendar } from "../../src/calendar/repository.js";
import { setLogLevel } from "../../src/core/logger.js";

setLogLevel("silent");

function installCalendars(calendars) {
  const created = [];
  globalThis.messenger = {
    assistantCalendar: {
      async listCalendars() {
        return calendars;
      },
      async createEvent(calendarId, event) {
        created.push({ calendarId, event });
        return { id: "evt-1", ...event };
      },
      async queryEvents() {
        return [];
      },
    },
  };
  return created;
}

const PERSONNEL = { id: "cal-perso", name: "Personnel", readOnly: false, enabled: true };
const ABONNE = { id: "cal-abonne", name: "Jours feries", readOnly: true, enabled: true };
const ETEINT = { id: "cal-eteint", name: "Ancien projet", readOnly: false, enabled: false };

beforeEach(() => {
  delete globalThis.messenger;
});

test("un calendrier est modifiable seulement s'il est ni en lecture seule ni desactive", () => {
  assert.equal(isWritable(PERSONNEL), true);
  assert.equal(isWritable(ABONNE), false);
  // Un calendrier desactive passe le test de lecture seule mais sera refuse
  // par Lightning : les deux conditions vont ensemble.
  assert.equal(isWritable(ETEINT), false);
});

test("sans calendrier configure, le premier modifiable est retenu", async () => {
  installCalendars([ABONNE, ETEINT, PERSONNEL]);
  const target = await resolveTargetCalendar("");
  assert.equal(target.id, "cal-perso");
});

test("un calendrier configure en lecture seule est refuse avant l'ecriture", async () => {
  installCalendars([PERSONNEL, ABONNE]);
  await assert.rejects(resolveTargetCalendar("cal-abonne"), (error) => {
    assert.match(error.message, /Jours feries/, "le message doit nommer le calendrier fautif");
    assert.match(error.message, /lecture seule/);
    assert.match(error.message, /Personnel/, "il doit proposer une alternative");
    assert.equal(error.code, "configuration");
    return true;
  });
});

test("un calendrier desactive est refuse avec sa vraie raison", async () => {
  installCalendars([PERSONNEL, ETEINT]);
  await assert.rejects(resolveTargetCalendar("cal-eteint"), /desactive/);
});

test("un calendrier configure puis supprime est signale comme tel", async () => {
  installCalendars([PERSONNEL]);
  await assert.rejects(resolveTargetCalendar("cal-disparu"), /n'existe plus/);
});

test("quand aucun calendrier n'est modifiable, on le dit clairement", async () => {
  installCalendars([ABONNE, ETEINT]);
  await assert.rejects(resolveTargetCalendar(""), /Aucun calendrier modifiable/);
});

test("sans aucun calendrier, le message ne parle pas de lecture seule", async () => {
  installCalendars([]);
  await assert.rejects(resolveTargetCalendar(""), /Aucun calendrier n'est configure/);
});

test("l'ecriture part bien vers le calendrier modifiable retenu", async () => {
  const created = installCalendars([ABONNE, PERSONNEL]);
  const { createEvent } = await import("../../src/calendar/repository.js");

  const result = await createEvent(
    { title: "Point equipe", date: "2026-09-10", startTime: "14:00" },
    { calendarId: "" }
  );

  assert.equal(result.created, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].calendarId, "cal-perso", "jamais vers le calendrier en lecture seule");
  assert.match(created[0].event.startDate, /^2026-09-10T/);
});
