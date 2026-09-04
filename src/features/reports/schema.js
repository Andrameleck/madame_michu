// Contrat de sortie d'un rapport. Le meme objet sert de schema envoye au modele
// et de validateur a la reception : impossible que les deux divergent.

export const IMPORTANCE_LEVELS = Object.freeze(["urgent", "important", "info", "autre"]);
export const CONFIDENCE_LEVELS = Object.freeze(["basse", "moyenne", "haute"]);

const ENTRY_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "Objet du message, recopie tel quel." },
    sender: { type: "string", description: "Nom de l'expediteur, sans son adresse." },
    importance: { type: "string", enum: [...IMPORTANCE_LEVELS] },
    summary: { type: "string", description: "Une phrase, en tutoyant l'utilisateur : ce que ce message attend de toi." },
    action: { type: "string", description: "Action attendue, en tutoyant l'utilisateur, ou chaine vide si aucune." },
    deadline: { type: "string", description: "Echeance AAAA-MM-JJ si le message en donne une, sinon vide." },
    messageIds: { type: "array", items: { type: "string" }, description: "Identifiants des messages resumes." },
  },
  required: ["subject", "sender", "importance", "summary", "messageIds"],
};

const EVENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    date: { type: "string", description: "AAAA-MM-JJ" },
    startTime: { type: "string", description: "HH:MM" },
    endTime: { type: "string", description: "HH:MM, vide si inconnue" },
    location: { type: "string" },
    description: { type: "string" },
    confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
    messageId: { type: "string" },
  },
  required: ["title", "date", "confidence", "messageId"],
};

export const REPORT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    overview: { type: "string", description: "Deux ou trois phrases, en tutoyant l'utilisateur : la situation d'ensemble." },
    entries: { type: "array", items: ENTRY_SCHEMA },
    events: { type: "array", items: EVENT_SCHEMA },
  },
  required: ["overview", "entries"],
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function cleanText(value, maxLength = 500) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Normalise la reponse du modele. Tout champ douteux est corrige ou ecarte :
 * un rapport partiel reste utile, un rapport invalide ne l'est pas.
 * @param {any} raw
 * @param {Set<string>} knownMessageIds identifiants reellement soumis au modele
 */
export function normalizeReport(raw, knownMessageIds = new Set()) {
  const entries = (Array.isArray(raw?.entries) ? raw.entries : [])
    .map((entry) => {
      const messageIds = (Array.isArray(entry?.messageIds) ? entry.messageIds : [])
        .map(String)
        // Un identifiant invente ne doit pas produire un lien mort dans l'UI.
        .filter((id) => !knownMessageIds.size || knownMessageIds.has(id));
      return {
        subject: cleanText(entry?.subject, 200) || "(sans objet)",
        sender: cleanText(entry?.sender, 120),
        importance: IMPORTANCE_LEVELS.includes(entry?.importance) ? entry.importance : "info",
        summary: cleanText(entry?.summary, 400),
        action: cleanText(entry?.action, 200),
        deadline: DATE_PATTERN.test(entry?.deadline) ? entry.deadline : "",
        messageIds,
      };
    })
    .filter((entry) => entry.summary || entry.subject !== "(sans objet)");

  const events = (Array.isArray(raw?.events) ? raw.events : [])
    .map((event) => ({
      title: cleanText(event?.title, 200),
      date: DATE_PATTERN.test(event?.date) ? event.date : "",
      startTime: TIME_PATTERN.test(event?.startTime) ? event.startTime : "",
      endTime: TIME_PATTERN.test(event?.endTime) ? event.endTime : "",
      location: cleanText(event?.location, 200),
      description: cleanText(event?.description, 500),
      confidence: CONFIDENCE_LEVELS.includes(event?.confidence) ? event.confidence : "basse",
      messageId: String(event?.messageId ?? ""),
    }))
    .filter((event) => event.title && event.date);

  return {
    overview: cleanText(raw?.overview, 1000),
    entries: sortByImportance(entries),
    events,
  };
}

function sortByImportance(entries) {
  const rank = Object.fromEntries(IMPORTANCE_LEVELS.map((level, index) => [level, index]));
  return [...entries].sort((left, right) => rank[left.importance] - rank[right.importance]);
}

/** Repartition par niveau, pour l'affichage en sections. */
export function groupByImportance(entries) {
  return Object.fromEntries(
    IMPORTANCE_LEVELS.map((level) => [level, entries.filter((entry) => entry.importance === level)])
  );
}
