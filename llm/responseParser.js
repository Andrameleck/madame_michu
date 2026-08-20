// Parsing robuste de la reponse LLM : le modele peut entourer le JSON de texte
// ou de blocs ```json, on essaie donc plusieurs strategies avant d'abandonner.

class LlmResponseError extends Error {}

const CONFIDENCE_LEVELS = ["basse", "moyenne", "haute"];

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

  if (typeof parsed.summary !== "string") {
    throw new LlmResponseError("Champ 'summary' manquant ou invalide dans la reponse LLM");
  }

  const events = Array.isArray(parsed.events) ? parsed.events : [];
  const cleanEvents = events
    .filter((ev) => ev && typeof ev.title === "string" && typeof ev.date === "string")
    .map((ev) => ({
      title: ev.title.trim(),
      date: ev.date.trim(),
      startTime: typeof ev.startTime === "string" ? ev.startTime.trim() : "",
      endTime: typeof ev.endTime === "string" ? ev.endTime.trim() : "",
      location: typeof ev.location === "string" ? ev.location.trim() : "",
      description: typeof ev.description === "string" ? ev.description.trim() : "",
      sourceEmailId: typeof ev.sourceEmailId === "string" ? ev.sourceEmailId.trim() : "",
      confidence: CONFIDENCE_LEVELS.includes(ev.confidence) ? ev.confidence : "basse",
    }));

  return { summary: parsed.summary.trim(), events: cleanEvents };
}
