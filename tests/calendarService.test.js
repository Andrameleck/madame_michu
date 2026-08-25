const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadService(assistantCalendar) {
  const context = vm.createContext({
    Date,
    logger: { warn() {} },
    messenger: { assistantCalendar },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "calendar", "calendarService.js"), "utf8"),
    context
  );
  return context;
}

test("choisit le premier calendrier actif et modifiable", async () => {
  const context = loadService({
    listCalendars: async () => [
      { id: "lecture", readOnly: true, enabled: true },
      { id: "inactif", readOnly: false, enabled: false },
      { id: "travail", readOnly: false, enabled: true },
    ],
  });
  const calendar = await vm.runInContext("getDefaultCalendar()", context);
  assert.equal(calendar.id, "travail");
});

test("conserve le premier calendrier modifiable par defaut", async () => {
  const context = loadService({
    listCalendars: async () => [
      { id: "personnel", name: "Personnel", readOnly: false, enabled: true },
      { id: "equipe", name: "Equipe", readOnly: false, enabled: true },
    ],
  });

  const calendar = await vm.runInContext("getDefaultCalendar()", context);

  assert.equal(calendar.id, "personnel");
});

test("n'ajoute pas un evenement portant deja le meme titre le meme jour", async () => {
  let createCalls = 0;
  const context = loadService({
    listCalendars: async () => [{ id: "travail", readOnly: false, enabled: true }],
    queryEvents: async () => [{ id: "existant", title: " Point equipe " }],
    createEvent: async () => {
      createCalls += 1;
    },
  });
  context.eventInput = {
    title: "point equipe",
    date: "2026-08-21",
    startTime: "09:00",
    endTime: "10:00",
  };
  const result = await vm.runInContext("createEventFromDetection(eventInput)", context);
  assert.equal(result.duplicate, true);
  assert.equal(createCalls, 0);
});

test("trie les prochains evenements de tous les calendriers actifs", async () => {
  const queriedCalendars = [];
  const context = loadService({
    listCalendars: async () => [
      { id: "travail", name: "Travail", enabled: true },
      { id: "famille", name: "Famille", enabled: true },
      { id: "archive", name: "Archive", enabled: false },
    ],
    queryEvents: async (calendarId) => {
      queriedCalendars.push(calendarId);
      if (calendarId === "travail") {
        return [{ id: "later", title: "Point equipe", startDate: "2026-08-22T09:00:00.000Z" }];
      }
      return [
        { id: "past", title: "Ancien", startDate: "2026-08-19T09:00:00.000Z" },
        { id: "next", title: "Visio", startDate: "2026-08-21T09:00:00.000Z" },
      ];
    },
  });
  context.options = { now: new Date("2026-08-20T10:00:00.000Z"), limit: 10 };

  const events = await vm.runInContext("getUpcomingCalendarEvents(options)", context);

  assert.deepEqual(queriedCalendars, ["travail", "famille"]);
  assert.deepEqual(Array.from(events, (event) => event.id), ["next", "later"]);
  assert.equal(events[0].calendarName, "Famille");
});

test("calcule les fenetres calendrier des rapports jour, semaine et mois", () => {
  const context = loadService({ listCalendars: async () => [] });
  context.now = new Date(2026, 7, 21, 14, 30);

  for (const [range, expectedStart, expectedEnd] of [
    ["day", [2026, 7, 21], [2026, 7, 23]],
    ["week", [2026, 7, 17], [2026, 7, 24]],
    ["month", [2026, 7, 1], [2026, 8, 1]],
  ]) {
    context.range = range;
    const result = vm.runInContext("getSummaryCalendarRange(range, now)", context);
    assert.deepEqual(
      [result.start.getFullYear(), result.start.getMonth(), result.start.getDate()],
      expectedStart
    );
    assert.deepEqual(
      [result.end.getFullYear(), result.end.getMonth(), result.end.getDate()],
      expectedEnd
    );
  }
});

test("recupere les evenements existants des calendriers actifs pour le rapport", async () => {
  const queried = [];
  const context = loadService({
    listCalendars: async () => [
      { id: "travail", name: "Travail", enabled: true },
      { id: "perso", name: "Personnel", enabled: true },
      { id: "masque", name: "Masque", enabled: false },
    ],
    queryEvents: async (calendarId, start, end) => {
      queried.push({ calendarId, start, end });
      if (calendarId === "travail") return [
        { id: "later", title: "Comite", startDate: "2026-08-22T09:00:00.000Z", endDate: "2026-08-22T10:00:00.000Z" },
        { id: "outside", title: "Trop tard", startDate: "2026-08-24T09:00:00.000Z", endDate: "2026-08-24T10:00:00.000Z" },
      ];
      return [{ id: "first", title: "Dentiste", startDate: "2026-08-21T15:00:00.000Z", endDate: "2026-08-21T16:00:00.000Z" }];
    },
  });
  context.options = { now: new Date(2026, 7, 21, 10, 0), limit: 10 };

  const events = await vm.runInContext("getSummaryCalendarEvents('day', options)", context);

  assert.deepEqual(queried.map(({ calendarId }) => calendarId), ["travail", "perso"]);
  assert.deepEqual(Array.from(events, ({ id }) => id), ["first", "later"]);
  assert.equal(events[0].calendarName, "Personnel");
  assert.match(events[0].sourceId, /^perso:first:/);
});

test("ajoute automatiquement les nouveaux rendez-vous et ignore les doublons", async () => {
  let createCalls = 0;
  let queryCalls = 0;
  const context = loadService({
    listCalendars: async () => [
      { id: "travail", name: "Travail", readOnly: false, enabled: true },
    ],
    queryEvents: async () => {
      queryCalls++;
      return queryCalls === 2 ? [{ id: "existing", title: "Comite API" }] : [];
    },
    createEvent: async () => {
      createCalls++;
      return { id: "created" };
    },
  });
  context.events = [
    { title: "Point Optirrig", date: "2099-08-21", startTime: "09:00", endTime: "10:00" },
    { title: "Comite API", date: "2099-08-22", startTime: "11:00", endTime: "12:00" },
  ];
  context.options = { now: new Date("2099-08-20T08:00:00.000Z") };

  const events = await vm.runInContext(
    "syncDetectedEventsToCalendar(events, options)",
    context
  );

  assert.equal(createCalls, 1);
  assert.equal(events[0].calendarCreated, true);
  assert.equal(events[0].calendarName, "Travail");
  assert.equal(events[1].calendarDuplicate, true);
});
