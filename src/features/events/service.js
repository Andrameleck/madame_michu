// Detection des rendez-vous et echeances dans les mails, puis inscription a
// l'agenda.
//
// Le rapport de periode detecte deja des evenements : ce service les reprend
// plutot que de relancer une analyse. Un scan direct reste possible quand
// l'utilisateur le demande explicitement.

import { createLogger } from "../../core/logger.js";
import { loadConfig } from "../../core/settings.js";
import { chatJson } from "../../llm/gateway.js";
import { listIdentities, queryMessages, readMessages, resolveScope } from "../../mail/repository.js";
import { createEvent, findDuplicate, isAvailable } from "../../calendar/repository.js";
import { queueWrite } from "../pendingWrites.js";
import { CONFIDENCE_LEVELS } from "../reports/schema.js";

const logger = createLogger("events");

const CONFIDENCE_RANK = Object.fromEntries(CONFIDENCE_LEVELS.map((level, index) => [level, index]));

const DETECTION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Titre court de l'evenement." },
          date: { type: "string", description: "AAAA-MM-JJ" },
          startTime: { type: "string", description: "HH:MM, vide si non precisee" },
          endTime: { type: "string", description: "HH:MM, vide si non precisee" },
          location: { type: "string" },
          description: { type: "string" },
          confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
          messageId: { type: "string", description: "Identifiant du message source." },
          concernsUser: { type: "boolean", description: "L'utilisateur est-il personnellement attendu ?" },
        },
        required: ["title", "date", "confidence", "messageId", "concernsUser"],
      },
    },
  },
  required: ["events"],
});

function buildSystemPrompt({ identities, now, language }) {
  const me = identities.map((identity) => `${identity.name || ""} <${identity.email}>`.trim()).join(", ");
  return [
    "Tu extrais les rendez-vous et echeances contenus dans des mails.",
    `Nous sommes le ${now.toISOString().slice(0, 10)} (${weekday(now)}).`,
    me ? `L'utilisateur, c'est : ${me}.` : "",
    "",
    "Ne retiens que ce qui engage personnellement l'utilisateur : reunion ou il est attendu,",
    "rendez-vous pris pour lui, date limite qui lui incombe.",
    "Ecarte les webinaires promotionnels, les invitations de masse et les newsletters.",
    "",
    "Resous les dates relatives (« mardi prochain », « demain ») en dates absolues a partir",
    "de la date du message, pas de la date du jour.",
    "Confiance : haute = date et heure explicites et sans ambiguite ; moyenne = date certaine mais",
    "heure deduite ; basse = formulation vague ou date reconstituee.",
    "Si un mail ne contient aucun rendez-vous, ne produis rien pour lui. Mieux vaut aucune",
    "detection qu'une detection inventee.",
    language === "en" ? "Titres et descriptions en anglais." : "Titres et descriptions en francais.",
  ].filter(Boolean).join("\n");
}

function weekday(date) {
  return ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][date.getDay()];
}

function buildUserPrompt(messages) {
  return messages
    .map((message) => [
      `### message ${message.id}`,
      `date du message: ${message.date}`,
      `de: ${message.author}`,
      `objet: ${message.subject}`,
      message.body || "(vide)",
    ].join("\n"))
    .join("\n\n");
}

/**
 * Analyse les mails recents et propose ou cree les evenements detectes.
 * @param {{ sinceDays?: number, config?: object, now?: Date, signal?: AbortSignal }} [options]
 */
export async function scanForEvents({ sinceDays = 7, config, now = new Date(), signal } = {}) {
  const settings = config || (await loadConfig());
  if (!isAvailable()) {
    return { available: false, detected: [], applied: [] };
  }

  const scope = await resolveScope(settings);
  const since = new Date(now);
  since.setDate(since.getDate() - sinceDays);
  const headers = await queryMessages(
    { ...scope, fromDate: since, toDate: now },
    { limit: settings.mail.maxMessagesPerRun }
  );
  if (!headers.length) return { available: true, detected: [], applied: [] };

  const [messages, identities] = await Promise.all([
    readMessages(headers.map((header) => header.id), { maxChars: settings.mail.maxBodyChars }),
    listIdentities().catch(() => []),
  ]);

  const response = await chatJson({
    messages: [
      { role: "system", content: buildSystemPrompt({ identities, now, language: settings.language }) },
      { role: "user", content: buildUserPrompt(messages) },
    ],
    responseSchema: DETECTION_SCHEMA,
    signal,
  }, { config: settings });

  const known = new Set(messages.map((message) => message.id));
  const detected = normalizeDetections(response.data?.events, known, settings.calendar.minConfidence);
  const applied = await applyDetections(detected, settings);
  logger.info("Scan d'evenements termine", {
    messages: messages.length,
    detected: detected.length,
    applied: applied.length,
  });
  return { available: true, detected, applied };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function normalizeDetections(raw, knownIds = new Set(), minConfidence = "moyenne") {
  const floor = CONFIDENCE_RANK[minConfidence] ?? 1;
  return (Array.isArray(raw) ? raw : [])
    .map((event) => ({
      title: String(event?.title || "").trim().slice(0, 200),
      date: DATE_PATTERN.test(event?.date) ? event.date : "",
      startTime: TIME_PATTERN.test(event?.startTime) ? event.startTime : "",
      endTime: TIME_PATTERN.test(event?.endTime) ? event.endTime : "",
      location: String(event?.location || "").trim().slice(0, 200),
      description: String(event?.description || "").trim().slice(0, 500),
      confidence: CONFIDENCE_LEVELS.includes(event?.confidence) ? event.confidence : "basse",
      messageId: String(event?.messageId || ""),
      concernsUser: event?.concernsUser !== false,
    }))
    .filter((event) =>
      event.title
      && event.date
      && event.concernsUser
      && CONFIDENCE_RANK[event.confidence] >= floor
      && (!knownIds.size || knownIds.has(event.messageId))
    );
}

/** Cree ou propose chaque detection, selon la configuration de l'utilisateur. */
async function applyDetections(detected, settings) {
  const applied = [];
  for (const event of detected) {
    try {
      const duplicate = await findDuplicate(event, settings.calendar.calendarId);
      if (duplicate) {
        applied.push({ event, status: "deja_present" });
        continue;
      }
      if (!settings.calendar.autoCreate || settings.calendar.confirmBeforeWrite) {
        const pending = await queueWrite({ type: "create_event", event, source: "scan" });
        applied.push({ event, status: "propose", writeId: pending.id });
        continue;
      }
      const result = await createEvent(event, { calendarId: settings.calendar.calendarId });
      applied.push({ event, status: result.created ? "cree" : "deja_present" });
    } catch (error) {
      applied.push({ event, status: "echec", error: error.message });
    }
  }
  return applied;
}

/** Reprend les evenements deja detectes par un rapport, sans nouvel appel LLM. */
export async function applyReportEvents(report, { config } = {}) {
  const settings = config || (await loadConfig());
  if (!isAvailable()) return { available: false, applied: [] };
  const detected = normalizeDetections(
    (report?.events || []).map((event) => ({ ...event, concernsUser: true })),
    new Set(),
    settings.calendar.minConfidence
  );
  return { available: true, applied: await applyDetections(detected, settings) };
}
