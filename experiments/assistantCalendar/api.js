/*
 * Minimal privileged bridge for Lightning. Thunderbird does not currently
 * expose calendar CRUD through a built-in MailExtension API, so this module
 * deliberately exposes only the operations needed by the add-on.
 *
 * Regle de survie de ce fichier : RIEN ne doit s'executer au chargement en
 * dehors de la definition de la classe. Un import de tete qui echoue empeche
 * la classe d'etre definie, et Thunderbird ne rapporte alors qu'un laconique
 * « module is not a constructor », sans dire ce qui a reellement casse.
 * Les modules de l'agenda sont donc resolus a la premiere utilisation.
 */

/* global ExtensionCommon, ExtensionUtils, ChromeUtils, Ci */

// Le bac a sable des scripts privilegies expose deja ExtensionCommon. On ne
// l'importe qu'en dernier recours, et sans jamais laisser l'echec remonter :
// la classe doit exister meme si la resolution echoue.
function resolveExtensionApiBase() {
  try {
    if (typeof ExtensionCommon !== "undefined" && ExtensionCommon?.ExtensionAPI) {
      return ExtensionCommon.ExtensionAPI;
    }
  } catch (error) {
    // Variable absente du bac a sable : on tente l'import ci-dessous.
  }
  try {
    const namespace = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
    return namespace?.ExtensionCommon?.ExtensionAPI || namespace?.ExtensionAPI || null;
  } catch (error) {
    return null;
  }
}

const ExtensionApiBase = resolveExtensionApiBase()
  || class {
    constructor(extension) {
      this.extension = extension;
    }
  };

function bridgeError(message) {
  try {
    if (typeof ExtensionUtils !== "undefined" && ExtensionUtils?.ExtensionError) {
      return new ExtensionUtils.ExtensionError(message);
    }
  } catch (error) {
    // Pas d'ExtensionError disponible : une Error ordinaire fait l'affaire,
    // elle traverse la frontiere de la meme facon.
  }
  return new Error(message);
}

// Modules de l'agenda, resolus une seule fois, a la demande.
let calendarModules = null;

function calendarApi() {
  if (calendarModules) return calendarModules;
  try {
    const { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
    const { CalEvent } = ChromeUtils.importESModule("resource:///modules/CalEvent.sys.mjs");
    const { CalTodo } = ChromeUtils.importESModule("resource:///modules/CalTodo.sys.mjs");
    calendarModules = { cal, CalEvent, CalTodo };
    return calendarModules;
  } catch (error) {
    throw bridgeError(
      "Le module Agenda de Thunderbird est introuvable ou a change d'emplacement "
        + `dans cette version (${error?.message || "cause inconnue"}).`
    );
  }
}

// `cal.createDateTime()` attend une chaine ICAL compacte (RFC 5545,
// « 20260905T140000Z »), pas un ISO 8601 JS (« 2026-09-05T14:00:00.000Z »).
// Lui passer un ISO 8601 casse le parseur d'ICAL.sys.mjs, qui decoupe la
// chaine a des positions fixes et tombe sur un « : » ou un « . » la ou il
// attend un chiffre (erreur « Could not extract integer from... »).
function toIcalUtcString(isoString) {
  const date = new Date(isoString);
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function getCalendar(calendarId) {
  const { cal } = calendarApi();
  const calendar = cal.manager.getCalendarById(calendarId);
  if (!calendar) {
    throw bridgeError(`Calendrier inconnu : ${calendarId}`);
  }
  return calendar;
}

function assertWritable(calendar) {
  if (calendar.readOnly || calendar.getProperty("disabled")) {
    throw bridgeError(`Le calendrier « ${calendar.name} » n'est pas modifiable.`);
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

// Miroir de toIcalUtcString() : `.toJSDate()` n'existe pas sur les objets
// calIDateTime rendus par cette version de Thunderbird. `.icalString` est le
// seul accesseur qui s'est montre fiable ici (c'est deja lui que la creation
// utilise en ecriture, avec succes). `getInTimezone` ramene d'abord en UTC un
// horaire local ou lie a un fuseau (evenement importe d'un calendrier distant).
function calDateTimeToIso(dateTime) {
  if (!dateTime) return "";
  const { cal } = calendarApi();
  const utc = typeof dateTime.getInTimezone === "function" ? dateTime.getInTimezone(cal.dtz.UTC) : dateTime;
  const match = String(utc.icalString || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

function serializeEvent(item) {
  return {
    id: item.id,
    title: item.title || "",
    startDate: calDateTimeToIso(item.startDate),
    endDate: calDateTimeToIso(item.endDate),
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
    entryDate: calDateTimeToIso(item.entryDate),
    dueDate: calDateTimeToIso(item.dueDate),
    completed: Boolean(item.isCompleted),
    description: item.getProperty("DESCRIPTION") || "",
  };
}

// Applique les proprietes communes evenement/tache : participants et regle de
// recurrence. Reutilise par createEvent et updateItem pour eviter que les deux
// chemins divergent silencieusement.
function applyAttendeesAndRecurrence(item, data) {
  const { cal } = calendarApi();
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

function itemFilter(typeFlag) {
  return (
    typeFlag |
    Ci.calICalendar.ITEM_FILTER_CLASS_OCCURRENCES |
    Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL
  );
}

// La documentation Thunderbird impose `var` ou `this.` : ni `let` ni `const`,
// que le chargeur de scripts privilegies ne verrait pas.
var assistantCalendar = class extends ExtensionApiBase {
  getAPI() {
    return {
      assistantCalendar: {
        async listCalendars() {
          const { cal } = calendarApi();
          return cal.manager.getCalendars().map(serializeCalendar);
        },

        async queryEvents(calendarId, rangeStart, rangeEnd) {
          const { cal } = calendarApi();
          const calendar = getCalendar(calendarId);
          const items = await calendar.getItemsAsArray(
            itemFilter(Ci.calICalendar.ITEM_FILTER_TYPE_EVENT),
            0,
            cal.createDateTime(toIcalUtcString(rangeStart)),
            cal.createDateTime(toIcalUtcString(rangeEnd))
          );
          return items.map(serializeEvent);
        },

        async createEvent(calendarId, eventData) {
          const { cal, CalEvent } = calendarApi();
          const calendar = getCalendar(calendarId);
          assertWritable(calendar);

          const item = new CalEvent();
          item.id = cal.getUUID();
          item.title = eventData.title;
          item.startDate = cal.createDateTime(toIcalUtcString(eventData.startDate));
          item.endDate = cal.createDateTime(toIcalUtcString(eventData.endDate));
          item.setProperty("LOCATION", eventData.location || "");
          item.setProperty("DESCRIPTION", eventData.description || "");
          applyAttendeesAndRecurrence(item, eventData);
          item.calendar = calendar.superCalendar;

          const created = await calendar.adoptItem(item);
          return serializeEvent(created);
        },

        async queryTasks(calendarId, rangeStart, rangeEnd) {
          const { cal } = calendarApi();
          const calendar = getCalendar(calendarId);
          const items = await calendar.getItemsAsArray(
            itemFilter(Ci.calICalendar.ITEM_FILTER_TYPE_TODO),
            0,
            cal.createDateTime(toIcalUtcString(rangeStart)),
            cal.createDateTime(toIcalUtcString(rangeEnd))
          );
          return items.map(serializeTask);
        },

        async createTask(calendarId, taskData) {
          const { cal, CalTodo } = calendarApi();
          const calendar = getCalendar(calendarId);
          assertWritable(calendar);

          const item = new CalTodo();
          item.id = cal.getUUID();
          item.title = taskData.title;
          if (taskData.entryDate) item.entryDate = cal.createDateTime(toIcalUtcString(taskData.entryDate));
          if (taskData.dueDate) item.dueDate = cal.createDateTime(toIcalUtcString(taskData.dueDate));
          item.setProperty("DESCRIPTION", taskData.description || "");
          item.calendar = calendar.superCalendar;

          const created = await calendar.adoptItem(item);
          return serializeTask(created);
        },

        // Generique evenement/tache : recupere l'element existant, en clone
        // une copie modifiable (obligatoire pour Lightning) et l'enregistre.
        async updateItem(calendarId, itemId, changes) {
          const { cal } = calendarApi();
          const calendar = getCalendar(calendarId);
          assertWritable(calendar);
          const original = await calendar.getItem(itemId);
          if (!original) throw bridgeError("Element de calendrier introuvable.");
          const item = original.clone();
          const isTask = item.isTodo?.() ?? false;

          if (changes.title !== undefined) item.title = changes.title;
          if (changes.location !== undefined) item.setProperty("LOCATION", changes.location || "");
          if (changes.description !== undefined) item.setProperty("DESCRIPTION", changes.description || "");
          applyAttendeesAndRecurrence(item, changes);

          if (isTask) {
            if (changes.entryDate) item.entryDate = cal.createDateTime(toIcalUtcString(changes.entryDate));
            if (changes.dueDate) item.dueDate = cal.createDateTime(toIcalUtcString(changes.dueDate));
            if (changes.completed !== undefined) item.isCompleted = Boolean(changes.completed);
          } else {
            if (changes.startDate) item.startDate = cal.createDateTime(toIcalUtcString(changes.startDate));
            if (changes.endDate) item.endDate = cal.createDateTime(toIcalUtcString(changes.endDate));
          }

          const updated = await calendar.modifyItem(item, original);
          return isTask ? serializeTask(updated) : serializeEvent(updated);
        },
      },
    };
  }
};
