// Rapports Jour / 7 jours / 30 jours.
//
// Un rapport n'utilise pas d'outils : la liste des messages de la periode est
// connue d'avance, un seul appel JSON suffit. Faire raisonner le modele en
// plusieurs tours ici couterait plus cher sans rien apporter.

import { createLogger } from "../../core/logger.js";
import { loadConfig } from "../../core/settings.js";
import { read, write } from "../../core/storage.js";
import { chatJson } from "../../llm/gateway.js";
import { listIdentities, queryMessages, readMessages, resolveScope } from "../../mail/repository.js";
import { getEvents, isAvailable as calendarAvailable } from "../../calendar/repository.js";
import { normalizeReport, REPORT_SCHEMA } from "./schema.js";

const logger = createLogger("reports");

export const RANGES = Object.freeze({
  day: { days: 1, label: "les dernieres 24 heures" },
  week: { days: 7, label: "les 7 derniers jours" },
  month: { days: 30, label: "les 30 derniers jours" },
});

const STATE_KEY = "reports";

export function normalizeRange(range) {
  return RANGES[range] ? range : "day";
}

function startOf(range, now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - RANGES[range].days);
  return start;
}

// Deux rapports identiques ne se distinguent que par leurs entrees : cette
// empreinte evite de rappeler le modele quand rien n'a change.
function fingerprint(messages, language) {
  return `${language}:${messages.length}:${messages.map((message) => message.id).sort().join(",")}`;
}

function buildSystemPrompt({ language, identities, now }) {
  const me = identities.map((identity) => `${identity.name || ""} <${identity.email}>`.trim()).join(", ");
  return [
    "Tu es l'assistante de messagerie de l'utilisateur. Tu produis un rapport factuel de ses mails.",
    `Nous sommes le ${now.toISOString().slice(0, 10)}.`,
    me ? `L'utilisateur, c'est : ${me}. « Moi » designe ces adresses.` : "",
    "",
    "Classe chaque message selon ce qu'il exige de l'utilisateur, pas selon le ton de l'expediteur :",
    "- urgent : une action lui est demandee sous 48 h, ou une echeance est proche.",
    "- important : le concerne directement et attend une suite, sans urgence immediate.",
    "- info : a lire, mais n'attend rien de lui.",
    "- autre : newsletters, notifications automatiques, publicites.",
    "",
    "Regroupe les messages d'une meme conversation en une seule entree.",
    "N'invente jamais un fait, un nom ou une date absents des messages.",
    "Recopie les identifiants de messages exactement tels qu'ils te sont donnes.",
    "Signale dans `events` les rendez-vous et echeances qui concernent personnellement",
    "l'utilisateur ; ignore ceux des newsletters et des invitations generiques.",
    language === "en" ? "Redige le rapport en anglais." : "Redige le rapport en francais.",
  ].filter(Boolean).join("\n");
}

function buildUserPrompt({ messages, events, rangeLabel }) {
  const agenda = events.length
    ? events.map((event) => `- ${event.startDate?.slice(0, 16)} ${event.title}`).join("\n")
    : "(agenda vide sur la periode)";
  const corpus = messages
    .map((message) => [
      `### message ${message.id}`,
      `date: ${message.date}`,
      `de: ${message.author}`,
      `objet: ${message.subject}`,
      `lu: ${message.read ? "oui" : "non"}`,
      "corps:",
      message.body || "(vide)",
    ].join("\n"))
    .join("\n\n");

  return [
    `Voici les messages recus sur ${rangeLabel}.`,
    "",
    "Rendez-vous deja notes a l'agenda :",
    agenda,
    "",
    "Messages :",
    corpus || "(aucun message sur la periode)",
  ].join("\n");
}

/**
 * Genere — ou renvoie depuis le cache — le rapport d'une periode.
 * @param {"day"|"week"|"month"} range
 * @param {{ force?: boolean, config?: object, now?: Date, signal?: AbortSignal }} [options]
 */
export async function generateReport(range, { force = false, config, now = new Date(), signal } = {}) {
  const key = normalizeRange(range);
  const settings = config || (await loadConfig());
  const stored = await getStoredReports();

  const scope = await resolveScope(settings);
  const headers = await queryMessages(
    { ...scope, fromDate: startOf(key, now), toDate: now },
    { limit: settings.mail.maxMessagesPerRun }
  );
  const signature = fingerprint(headers, settings.language);

  const previous = stored[key];
  if (!force && previous?.fingerprint === signature) {
    logger.debug("Rapport inchange, cache conserve", { range: key });
    return { ...previous, fromCache: true };
  }

  if (!headers.length) {
    const empty = emptyReport(key, signature, now);
    await storeReport(key, empty);
    return { ...empty, fromCache: false };
  }

  const [messages, identities, events] = await Promise.all([
    readMessages(headers.map((header) => header.id), { maxChars: settings.mail.maxBodyChars }),
    listIdentities().catch(() => []),
    calendarAvailable()
      ? getEvents(startOf(key, now), addDays(now, 14), { limit: 50 }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const response = await chatJson({
    messages: [
      { role: "system", content: buildSystemPrompt({ language: settings.language, identities, now }) },
      { role: "user", content: buildUserPrompt({ messages, events, rangeLabel: RANGES[key].label }) },
    ],
    responseSchema: REPORT_SCHEMA,
    signal,
  }, { config: settings });

  const report = {
    range: key,
    generatedAt: new Date().toISOString(),
    fingerprint: signature,
    messageCount: messages.length,
    profileId: response.profileId,
    ...normalizeReport(response.data, new Set(messages.map((message) => message.id))),
  };
  await storeReport(key, report);
  logger.info("Rapport genere", {
    range: key,
    messages: messages.length,
    entries: report.entries.length,
  });
  return { ...report, fromCache: false };
}

function emptyReport(range, signature, now) {
  return {
    range,
    generatedAt: now.toISOString(),
    fingerprint: signature,
    messageCount: 0,
    overview: "Aucun message sur la periode.",
    entries: [],
    events: [],
  };
}

function addDays(date, days) {
  const output = new Date(date);
  output.setDate(output.getDate() + days);
  return output;
}

export async function getStoredReports() {
  return (await read(STATE_KEY, {})) || {};
}

export async function getReport(range) {
  const stored = await getStoredReports();
  return stored[normalizeRange(range)] || null;
}

async function storeReport(range, report) {
  const stored = await getStoredReports();
  await write(STATE_KEY, { ...stored, [range]: report });
}
