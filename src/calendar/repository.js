// Acces au calendrier, via l'Experiment API `assistantCalendar` qui encapsule
// l'API interne de Lightning. C'est la seule partie privilegiee de
// l'extension : tout ce qui la concerne reste concentre ici.

import { HostError, toAppError } from "../core/errors.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("calendar");

function api() {
  if (typeof messenger === "undefined" || !messenger.assistantCalendar) {
    throw new HostError(
      "Le pont calendrier n'est pas disponible. Verifie que le module Agenda de Thunderbird est actif.",
      { code: "unsupported" }
    );
  }
  return messenger.assistantCalendar;
}

/** Le calendrier existe-t-il dans cette installation ? */
export function isAvailable() {
  return typeof messenger !== "undefined" && Boolean(messenger?.assistantCalendar);
}

export async function listCalendars() {
  return api().listCalendars();
}

/** Calendrier cible : celui configure, sinon le premier accessible en ecriture. */
export async function resolveTargetCalendar(calendarId = "") {
  const calendars = await listCalendars();
  if (!calendars.length) {
    throw new HostError("Aucun calendrier n'est configure dans Thunderbird.", { code: "configuration" });
  }
  const writable = calendars.filter(isWritable);

  const chosen = calendarId ? calendars.find((calendar) => calendar.id === calendarId) : null;
  if (calendarId && !chosen) {
    throw new HostError(
      "Le calendrier choisi dans les options n'existe plus. Selectionnes-en un autre.",
      { code: "configuration" }
    );
  }
  // Un calendrier choisi mais non modifiable etait auparavant utilise quand
  // meme : l'ecriture partait, et Lightning la refusait avec un message que
  // rien ne rattachait au reglage fautif.
  if (chosen && !isWritable(chosen)) {
    throw new HostError(
      `Le calendrier « ${chosen.name} » n'accepte pas d'ecriture`
        + `${chosen.enabled === false ? " (il est desactive)" : " (il est en lecture seule)"}. `
        + (writable.length
          ? `Choisis-en un autre dans les options, par exemple « ${writable[0].name} ».`
          : "Aucun de tes calendriers n'est modifiable."),
      { code: "configuration" }
    );
  }
  if (chosen) return chosen;

  if (!writable.length) {
    throw new HostError(
      "Aucun calendrier modifiable : ils sont tous en lecture seule ou desactives.",
      { code: "configuration" }
    );
  }
  return writable[0];
}

/**
 * Lightning refuse une ecriture sur un calendrier en lecture seule *ou*
 * desactive. Les deux conditions doivent donc etre testees ensemble, sinon on
 * propose un calendrier que le pont rejettera.
 */
export function isWritable(calendar) {
  return calendar?.readOnly !== true && calendar?.enabled !== false;
}

/**
 * Evenements de tous les calendriers sur une plage.
 * @param {Date|string} start
 * @param {Date|string} end
 * @param {{ limit?: number, calendarId?: string }} [options]
 */
export async function getEvents(start, end, { limit = 100, calendarId = "" } = {}) {
  const bridge = api();
  const from = new Date(start).toISOString();
  const to = new Date(end).toISOString();
  const calendars = calendarId
    ? [{ id: calendarId }]
    : await listCalendars();

  const events = [];
  for (const calendar of calendars) {
    try {
      const items = await bridge.queryEvents(calendar.id, from, to);
      events.push(...items.map((item) => ({ ...item, calendarId: calendar.id })));
    } catch (error) {
      // Un calendrier distant injoignable ne doit pas vider tout l'agenda.
      logger.warn("Calendrier illisible, ignore", {
        calendar: calendar.id,
        reason: toAppError(error).message,
      });
    }
  }
  return events
    .sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate))
    .slice(0, limit);
}

/** Combine une date « YYYY-MM-DD » et une heure « HH:MM » en heure locale. */
export function localDateTime(date, time = "00:00") {
  const [year, month, day] = String(date).split("-").map(Number);
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0);
}

/** Un evenement de meme titre existe-t-il deja ce jour-la ? */
export async function findDuplicate({ title, date }, calendarId) {
  const existing = await getEvents(
    localDateTime(date, "00:00"),
    localDateTime(date, "23:59"),
    { calendarId }
  );
  const normalized = String(title).trim().toLowerCase();
  return existing.find((item) => String(item.title || "").trim().toLowerCase() === normalized) || null;
}

/**
 * Cree un evenement, sauf s'il existe deja.
 * @param {{ title: string, date: string, startTime?: string, endTime?: string,
 *           location?: string, description?: string }} event
 * @param {{ calendarId?: string }} [options]
 */
export async function createEvent(event, { calendarId = "" } = {}) {
  const calendar = await resolveTargetCalendar(calendarId);
  const duplicate = await findDuplicate(event, calendar.id);
  if (duplicate) return { created: false, duplicate: true, event: duplicate };

  const start = localDateTime(event.date, event.startTime || "09:00");
  const end = event.endTime
    ? localDateTime(event.date, event.endTime)
    : new Date(start.getTime() + 60 * 60 * 1000);

  const created = await api().createEvent(calendar.id, {
    title: event.title,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    location: event.location || "",
    description: event.description || "",
  });
  logger.info("Evenement cree", { calendar: calendar.id, date: event.date });
  return { created: true, duplicate: false, event: { ...created, calendarId: calendar.id } };
}
