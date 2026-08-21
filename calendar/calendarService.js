// Integration avec Lightning via l'Experiment API minimale assistantCalendar.

async function getPreferredCalendar({ calendarId, preferredName = "INRAE" } = {}) {
  const calendars = await messenger.assistantCalendar.listCalendars();
  if (!calendars.length) {
    throw new Error("Aucun calendrier disponible dans Thunderbird (Lightning).");
  }
  const writable = calendars.filter((calendar) => calendar.enabled && !calendar.readOnly);
  if (!writable.length) {
    throw new Error("Aucun calendrier modifiable n'est disponible dans Thunderbird.");
  }
  const selected = calendarId && writable.find((calendar) => calendar.id === calendarId);
  if (selected) return selected;
  const normalizedName = preferredName.trim().toLocaleLowerCase();
  return (
    writable.find((calendar) => calendar.name?.toLocaleLowerCase().includes(normalizedName)) ||
    writable[0]
  );
}

async function getDefaultCalendar() {
  return getPreferredCalendar();
}

async function listCalendars() {
  return messenger.assistantCalendar.listCalendars();
}

function getSummaryCalendarRange(range, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  if (range === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
  } else if (range === "month") {
    start.setDate(1);
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 1);
  } else {
    // Le rapport quotidien donne aussi le programme du lendemain, plus utile
    // qu'un agenda qui attend la reunion pour signaler son existence.
    end.setDate(end.getDate() + 2);
  }
  return { start, end };
}

async function getSummaryCalendarEvents(range, { limit = 100, now = new Date() } = {}) {
  const { start, end } = getSummaryCalendarRange(range, now);
  return getCalendarEventsBetween(start, end, { limit });
}

async function getCalendarEventsBetween(start, end, { limit = 100 } = {}) {
  const calendars = await messenger.assistantCalendar.listCalendars();
  const events = [];
  const seen = new Set();

  for (const calendar of calendars.filter((item) => item.enabled)) {
    try {
      const items = await messenger.assistantCalendar.queryEvents(
        calendar.id,
        start.toISOString(),
        end.toISOString()
      );
      for (const event of items) {
        const startTime = Date.parse(event.startDate);
        const endTime = Date.parse(event.endDate || event.startDate);
        if (!Number.isFinite(startTime) || startTime >= end.getTime()) continue;
        if (Number.isFinite(endTime) && endTime <= start.getTime()) continue;
        const key = `${calendar.id}:${event.id}:${event.startDate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({
          ...event,
          sourceId: key,
          calendarId: calendar.id,
          calendarName: calendar.name,
        });
      }
    } catch (error) {
      logger.warn("Impossible de lire le calendrier pour le rapport", calendar.id, error);
    }
  }

  return events
    .sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate))
    .slice(0, limit);
}

async function getUpcomingCalendarEvents({ limit = 20, days = 365, now = new Date() } = {}) {
  const calendars = await messenger.assistantCalendar.listCalendars();
  const rangeEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const upcoming = [];

  for (const calendar of calendars.filter((item) => item.enabled)) {
    try {
      const events = await messenger.assistantCalendar.queryEvents(
        calendar.id,
        now.toISOString(),
        rangeEnd.toISOString()
      );
      for (const event of events) {
        const startTime = Date.parse(event.startDate);
        if (!Number.isFinite(startTime) || startTime < now.getTime()) continue;
        upcoming.push({ ...event, calendarId: calendar.id, calendarName: calendar.name });
      }
    } catch (error) {
      logger.warn("Impossible de lire le calendrier", calendar.id, error);
    }
  }

  return upcoming
    .sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate))
    .slice(0, limit);
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

  const items = await messenger.assistantCalendar.queryEvents(
    calendarId,
    start.toISOString(),
    end.toISOString()
  );

  const normalizedTitle = evt.title.trim().toLowerCase();
  return items.find((item) => (item.title || "").trim().toLowerCase() === normalizedTitle);
}

async function createEventFromDetection(evt, { calendarId, preferredName = "INRAE" } = {}) {
  const calendar = calendarId
    ? { id: calendarId }
    : await getPreferredCalendar({ preferredName });

  const existing = await findSimilarEvent(calendar.id, evt);
  if (existing) {
    return { created: false, duplicate: true, item: existing };
  }

  const startDate = toIcalDateTime(evt.date, evt.startTime || "09:00");
  const endDate = evt.endTime
    ? toIcalDateTime(evt.date, evt.endTime)
    : new Date(startDate.getTime() + 60 * 60 * 1000);

  const item = await messenger.assistantCalendar.createEvent(calendar.id, {
    title: evt.title,
    location: evt.location || "",
    description: evt.description || "",
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  });

  return { created: true, duplicate: false, item };
}

async function syncDetectedEventsToCalendar(
  events,
  { calendarId, preferredName = "INRAE", now = new Date() } = {}
) {
  if (!events.length) return [];
  const calendar = await getPreferredCalendar({ calendarId, preferredName });
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const synchronized = [];

  for (const event of events) {
    const eventDate = toIcalDateTime(event.date, event.startTime);
    if (eventDate < today) {
      synchronized.push({ ...event, calendarSkipped: true, calendarName: calendar.name });
      continue;
    }
    try {
      const result = await createEventFromDetection(event, { calendarId: calendar.id });
      synchronized.push({
        ...event,
        calendarCreated: result.created,
        calendarDuplicate: result.duplicate,
        calendarName: calendar.name,
      });
    } catch (error) {
      logger.warn("Ajout automatique du rendez-vous impossible", event.title, error);
      synchronized.push({
        ...event,
        calendarError: error.message || "Ajout automatique impossible",
        calendarName: calendar.name,
      });
    }
  }
  return synchronized;
}
