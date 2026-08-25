// Parsing robuste de la reponse LLM : le modele peut entourer le JSON de texte
// ou de blocs ```json, on essaie donc plusieurs strategies avant d'abandonner.

class LlmResponseError extends Error {}

const CONFIDENCE_LEVELS = ["basse", "moyenne", "haute"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SUMMARY_SECTION_KEYS = ["urgent", "important", "info", "other"];

// Les identifiants Thunderbird servent uniquement a relier une synthese a ses
// boutons source. Certains modeles les recopient malgre le schema JSON : ils ne
// doivent jamais apparaitre dans une valeur destinee a l'utilisateur.
function cleanUserFacingSummaryText(value, maxLength = 4000) {
  return String(value || "")
    .replace(/\s*(?:sources?|sourceEmailIds?|mail sources?)\s*:\s*account\d+:[^\n]*(?:\n|$)/gim, " ")
    .replace(/\baccount\d+:[^\s,;\])}]+/gi, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanSummaryItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim() ? {
          senderName: "",
          action: "",
          need: "",
          text: cleanUserFacingSummaryText(item),
          sourceEmailIds: [],
        } : null;
      }
      if (!item || typeof item !== "object" || typeof item.text !== "string") return null;
      const sourceEmailIds = Array.isArray(item.sourceEmailIds)
        ? [...new Set(item.sourceEmailIds
          .filter((id) => typeof id === "string" && id.trim())
          .map((id) => id.trim().slice(0, 1000)))]
        : [];
      const cleanText = cleanUserFacingSummaryText(item.text);
      return cleanText
        ? {
          senderName: cleanUserFacingSummaryText(item.senderName, 500),
          action: cleanUserFacingSummaryText(item.action, 500),
          need: cleanUserFacingSummaryText(item.need, 1000),
          text: cleanText,
          sourceEmailIds,
        }
        : null;
    })
    .filter(Boolean);
}

function parseSummary(summary) {
  if (typeof summary === "string") {
    return { summary: cleanUserFacingSummaryText(summary, 12000), summarySections: null };
  }
  if (!summary || typeof summary !== "object" || typeof summary.overview !== "string") {
    throw new LlmResponseError("Champ 'summary' manquant ou invalide dans la reponse LLM");
  }

  const summarySections = { overview: cleanUserFacingSummaryText(summary.overview, 6000) };
  for (const key of SUMMARY_SECTION_KEYS) {
    summarySections[key] = cleanSummaryItems(summary[key]);
  }
  const labels = { urgent: "Urgent", important: "Important", info: "Info", other: "Autre" };
  const markdown = [summarySections.overview];
  for (const key of SUMMARY_SECTION_KEYS) {
    if (!summarySections[key].length) continue;
    markdown.push(`## ${labels[key]}`, ...summarySections[key].map((item) => `- ${item.text}`));
  }
  return { summary: markdown.filter(Boolean).join("\n\n"), summarySections };
}

function isValidDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function extractJsonBlock(raw) {
  if (!raw) throw new LlmResponseError("Reponse LLM vide");

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }

  return raw.trim();
}

function parseLlmResponse(raw) {
  const jsonText = extractJsonBlock(raw);

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new LlmResponseError(`JSON invalide renvoye par le LLM: ${e.message}`);
  }

  const { summary, summarySections } = parseSummary(parsed.summary);

  const events = Array.isArray(parsed.events) ? parsed.events : [];
  const cleanEvents = events
    .filter(
      (ev) =>
        ev &&
        typeof ev.title === "string" &&
        ev.title.trim() &&
        typeof ev.date === "string" &&
        isValidDate(ev.date.trim()) &&
        typeof ev.startTime === "string" &&
        TIME_PATTERN.test(ev.startTime.trim()) &&
        (ev.endTime === "" ||
          (typeof ev.endTime === "string" &&
            TIME_PATTERN.test(ev.endTime.trim()) &&
            ev.endTime.trim() > ev.startTime.trim()))
    )
    .map((ev) => ({
      title: ev.title.trim(),
      date: ev.date.trim(),
      startTime: typeof ev.startTime === "string" ? ev.startTime.trim() : "",
      endTime: typeof ev.endTime === "string" ? ev.endTime.trim() : "",
      location: typeof ev.location === "string" ? ev.location.trim() : "",
      description: typeof ev.description === "string" ? ev.description.trim().slice(0, 4000) : "",
      sourceEmailId: typeof ev.sourceEmailId === "string" ? ev.sourceEmailId.trim() : "",
      confidence: CONFIDENCE_LEVELS.includes(ev.confidence) ? ev.confidence : "basse",
    }));

  return { summary, summarySections, events: cleanEvents };
}
