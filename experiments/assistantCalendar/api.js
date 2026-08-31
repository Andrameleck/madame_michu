/*
 * Minimal privileged bridge for Lightning. Thunderbird does not currently
 * expose calendar CRUD through a built-in MailExtension API, so this module
 * deliberately exposes only the operations needed by the add-on.
 */

const { ExtensionAPI } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
).ExtensionCommon;
const { ExtensionError } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
).ExtensionUtils;
const { cal } = ChromeUtils.importESModule(
  "resource:///modules/calendar/calUtils.sys.mjs"
);
const { CalEvent } = ChromeUtils.importESModule(
  "resource:///modules/CalEvent.sys.mjs"
);
const { CalTodo } = ChromeUtils.importESModule(
  "resource:///modules/CalTodo.sys.mjs"
);

function getCalendar(calendarId) {
  const calendar = cal.manager.getCalendarById(calendarId);
  if (!calendar) {
    throw new ExtensionError(`Calendrier inconnu : ${calendarId}`);
  }
  return calendar;
}

function assertWritable(calendar) {
  if (calendar.readOnly || calendar.getProperty("disabled")) {
    throw new ExtensionError("Ce calendrier n'est pas modifiable.");
  }
}

function serializeCalendar(calendar) {
  return {
    id: calendar.id,
    name: calendar.name,
    readOnly: calendar.readOnly,
    enabled: !calendar.getProperty("disabled"),
  };
}

function serializeEvent(item) {
  return {
    id: item.id,
    title: item.title || "",
    startDate: item.startDate?.toJSDate().toISOString() || "",
    endDate: item.endDate?.toJSDate().toISOString() || "",
    location: item.getProperty("LOCATION") || "",
    description: item.getProperty("DESCRIPTION") || "",
    allDay: Boolean(item.startDate?.isDate),
    recurrence: item.getProperty("RRULE") || "",
    attendees: item.getAttendees({}).map((attendee) => attendee.id.replace(/^mailto:/i, "")),
  };
}

// Les taches partagent le meme backend Lightning que les evenements, mais
// leurs dates utilisent entryDate/dueDate plutot que startDate/endDate.
function serializeTask(item) {
  return {
    id: item.id,
    title: item.title || "",
    entryDate: item.entryDate?.toJSDate().toISOString() || "",
    dueDate: item.dueDate?.toJSDate().toISOString() || "",
    completed: Boolean(item.isCompleted),
    description: item.getProperty("DESCRIPTION") || "",
  };
}

// Applique les proprietes communes evenement/tache : participants et regle de
// recurrence. Reutilise par createEvent et updateItem pour eviter que les deux
// chemins divergent silencieusement.
function applyAttendeesAndRecurrence(item, data) {
  if (data.recurrence !== undefined) {
    if (data.recurrence) item.setProperty("RRULE", String(data.recurrence).replace(/^RRULE:/i, ""));
    else item.deleteProperty("RRULE");
  }
  if (Array.isArray(data.attendees)) {
    for (const existing of item.getAttendees({})) item.removeAttendee(existing);
    for (const email of data.attendees) {
      const attendee = cal.createAttendee();
      attendee.id = `mailto:${String(email).replace(/^mailto:/i, "")}`;
      attendee.role = "REQ-PARTICIPANT";
      attendee.participationStatus = "NEEDS-ACTION";
      item.addAttendee(attendee);
    }
  }
}

this.assistantCalendar = class extends ExtensionAPI {
  getAPI() {
    return {
      assistantCalendar: {
        async listCalendars() {
          return cal.manager.getCalendars().map(serializeCalendar);
        },

        async queryEvents(calendarId, rangeStart, rangeEnd) {
          const calendar = getCalendar(calendarId);
          const filter =
            Ci.calICalendar.ITEM_FILTER_TYPE_EVENT |
            Ci.calICalendar.ITEM_FILTER_CLASS_OCCURRENCES |
            Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL;
          const items = await calendar.getItemsAsArray(
            filter,
            0,
            cal.createDateTime(rangeStart),
            cal.createDateTime(rangeEnd)
          );
          return items.map(serializeEvent);
        },

        async createEvent(calendarId, eventData) {
          const calendar = getCalendar(calendarId);
          assertWritable(calendar);

          const item = new CalEvent();
          item.id = cal.getUUID();
          item.title = eventData.title;
          item.startDate = cal.createDateTime(eventData.startDate);
          item.endDate = cal.createDateTime(eventData.endDate);
          item.setProperty("LOCATION", eventData.location || "");
          item.setProperty("DESCRIPTION", eventData.description || "");
          applyAttendeesAndRecurrence(item, eventData);
          item.calendar = calendar.superCalendar;

          const created = await calendar.adoptItem(item);
          return serializeEvent(created);
        },

        async queryTasks(calendarId, rangeStart, rangeEnd) {
          const calendar = getCalendar(calendarId);
          const filter =
            Ci.calICalendar.ITEM_FILTER_TYPE_TODO |
            Ci.calICalendar.ITEM_FILTER_CLASS_OCCURRENCES |
            Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL;
          const items = await calendar.getItemsAsArray(
            filter,
            0,
            cal.createDateTime(rangeStart),
            cal.createDateTime(rangeEnd)
          );
          return items.map(serializeTask);
        },

        async createTask(calendarId, taskData) {
          const calendar = getCalendar(calendarId);
          assertWritable(calendar);

          const item = new CalTodo();
          item.id = cal.getUUID();
          item.title = taskData.title;
          if (taskData.entryDate) item.entryDate = cal.createDateTime(taskData.entryDate);
          if (taskData.dueDate) item.dueDate = cal.createDateTime(taskData.dueDate);
          item.setProperty("DESCRIPTION", taskData.description || "");
          item.calendar = calendar.superCalendar;

          const created = await calendar.adoptItem(item);
          return serializeTask(created);
        },

        // Generique evenement/tache : recupere l'element existant, en clone
        // une copie modifiable (obligatoire pour Lightning) et l'enregistre.
        async updateItem(calendarId, itemId, changes) {
          const calendar = getCalendar(calendarId);
          assertWritable(calendar);
          const original = await calendar.getItem(itemId);
          if (!original) throw new ExtensionError("Element de calendrier introuvable.");
          const item = original.clone();
          const isTask = item.isTodo?.() ?? false;

          if (changes.title !== undefined) item.title = changes.title;
          if (changes.location !== undefined) item.setProperty("LOCATION", changes.location || "");
          if (changes.description !== undefined) item.setProperty("DESCRIPTION", changes.description || "");
          applyAttendeesAndRecurrence(item, changes);

          if (isTask) {
            if (changes.entryDate) item.entryDate = cal.createDateTime(changes.entryDate);
            if (changes.dueDate) item.dueDate = cal.createDateTime(changes.dueDate);
            if (changes.completed !== undefined) item.isCompleted = Boolean(changes.completed);
          } else {
            if (changes.startDate) item.startDate = cal.createDateTime(changes.startDate);
            if (changes.endDate) item.endDate = cal.createDateTime(changes.endDate);
          }

          const updated = await calendar.modifyItem(item, original);
          return isTask ? serializeTask(updated) : serializeEvent(updated);
        },
      },
    };
  }
};
