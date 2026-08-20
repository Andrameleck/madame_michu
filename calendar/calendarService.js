// Integration avec l'API messenger.calendar de Thunderbird. Toute creation
// d'evenement passe par ce module et n'a jamais lieu sans validation explicite
// de l'utilisateur dans la sidebar (voir ui/sidebar/sidebar.js).

async function getDefaultCalendar() {
  const calendars = await messenger.calendar.calendars.query({});
  if (!calendars.length) {
    throw new Error("Aucun calendrier disponible dans Thunderbird (Lightning).");
  }
  // On privilegie un calendrier local non en lecture seule.
  const writable = calendars.find((c) => !c.readOnly) || calendars[0];
  return writable;
}

async function listCalendars() {
  return messenger.calendar.calendars.query({});
}

function toIcalDateTime(date, time) {
  // date: "YYYY-MM-DD", time: "HH:MM" -> Date locale
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = (time || "00:00").split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, h || 0, min || 0);
}

// Verifie si un evenement de titre/date similaire existe deja, pour eviter les doublons.
async function findSimilarEvent(calendarId, evt) {
  const start = toIcalDateTime(evt.date, "00:00");
  const end = toIcalDateTime(evt.date, "23:59");

  const items = await messenger.calendar.items.query({
    calendarId,
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
    type: "event",
  });

  const normalizedTitle = evt.title.trim().toLowerCase();
  return items.find((item) => (item.title || "").trim().toLowerCase() === normalizedTitle);
}

async function createEventFromDetection(evt, { calendarId } = {}) {
  const calendar = calendarId
    ? { id: calendarId }
    : await getDefaultCalendar();

  const existing = await findSimilarEvent(calendar.id, evt);
  if (existing) {
    return { created: false, duplicate: true, item: existing };
  }

  const startDate = toIcalDateTime(evt.date, evt.startTime || "09:00");
  const endDate = evt.endTime
    ? toIcalDateTime(evt.date, evt.endTime)
    : new Date(startDate.getTime() + 60 * 60 * 1000);

  const item = await messenger.calendar.items.create(calendar.id, {
    type: "event",
    title: evt.title,
    location: evt.location || "",
    description: evt.description || "",
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  });

  return { created: true, duplicate: false, item };
}
