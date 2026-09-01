// Outils d'agenda. La creation d'evenement est le seul outil « write » du jeu
// standard : il passe par la file de confirmation si la configuration l'exige,
// et n'ecrit alors rien avant validation de l'utilisateur.

import { defineTool } from "../toolRegistry.js";
import { createEvent, getEvents, isAvailable } from "../../calendar/repository.js";

function isoDay(days = 0, now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export const listEventsTool = defineTool({
  name: "list_events",
  description:
    "Liste les evenements de l'agenda sur une periode. Sert a repondre aux questions d'emploi du "
    + "temps et a verifier qu'un rendez-vous trouve dans un mail n'est pas deja note.",
  parameters: {
    type: "object",
    properties: {
      from_date: { type: "string", description: "Debut de la periode, AAAA-MM-JJ (defaut : aujourd'hui)." },
      to_date: { type: "string", description: "Fin de la periode, AAAA-MM-JJ (defaut : dans 30 jours)." },
      limit: { type: "integer", description: "Nombre maximum d'evenements.", minimum: 1, maximum: 100 },
    },
  },
  risk: "read",
  async handler(args) {
    if (!isAvailable()) return { disponible: false, evenements: [] };
    const from = new Date(`${args.from_date || isoDay(0)}T00:00:00`);
    const to = new Date(`${args.to_date || isoDay(30)}T23:59:59`);
    const events = await getEvents(from, to, { limit: args.limit || 50 });
    return {
      disponible: true,
      periode: `${from.toISOString().slice(0, 10)} au ${to.toISOString().slice(0, 10)}`,
      evenements: events.map((event) => ({
        titre: event.title,
        debut: event.startDate,
        fin: event.endDate,
        lieu: event.location || "",
      })),
    };
  },
});

export const createEventTool = defineTool({
  name: "create_event",
  description:
    "Ajoute un evenement a l'agenda. N'utilise cet outil que pour un rendez-vous reellement destine a "
    + "l'utilisateur, avec une date certaine. En cas de doute sur la date ou le caractere personnel du "
    + "rendez-vous, ne l'utilise pas et signale-le dans ta reponse.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Titre court et explicite." },
      date: { type: "string", description: "Jour de l'evenement, AAAA-MM-JJ." },
      start_time: { type: "string", description: "Heure de debut, HH:MM (defaut 09:00)." },
      end_time: { type: "string", description: "Heure de fin, HH:MM (defaut : une heure apres le debut)." },
      location: { type: "string", description: "Lieu ou lien de visioconference." },
      description: { type: "string", description: "Contexte utile, dont l'expediteur du mail source." },
      source_message_id: { type: "string", description: "Identifiant du mail d'ou vient l'information." },
    },
    required: ["title", "date"],
  },
  risk: "write",
  async handler(args, context) {
    const event = {
      title: args.title,
      date: args.date,
      startTime: args.start_time,
      endTime: args.end_time,
      location: args.location,
      description: args.description,
      sourceMessageId: args.source_message_id,
    };

    // La confirmation est portee par l'appelant : le moteur d'agent ne decide
    // jamais seul d'ecrire dans les donnees de l'utilisateur.
    if (context.confirmWrites && context.queueWrite) {
      const pending = await context.queueWrite({ type: "create_event", event });
      return {
        statut: "en_attente_de_validation",
        id_proposition: pending.id,
        message: "L'evenement est propose a l'utilisateur, il n'est pas encore inscrit.",
      };
    }

    const result = await createEvent(event, { calendarId: context.calendarId });
    return result.duplicate
      ? { statut: "deja_present", message: "Un evenement identique existe deja ce jour-la." }
      : { statut: "cree", titre: args.title, date: args.date };
  },
});

export const calendarTools = [listEventsTool, createEventTool];
