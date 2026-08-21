// Connecteur pour un LLM local via Ollama (http://localhost:11434 par defaut).
// Aucune cle API n'est necessaire : le connecteur refuse les hotes non locaux.

const DEFAULT_TIMEOUT_MS = 120_000;

const SUMMARY_ITEM_SCHEMA = {
  type: "object",
  properties: {
    senderName: { type: "string" },
    action: { type: "string" },
    need: { type: "string" },
    text: { type: "string" },
    sourceEmailIds: { type: "array", items: { type: "string" } },
  },
  required: ["senderName", "action", "need", "text", "sourceEmailIds"],
};

const SUMMARY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        overview: { type: "string" },
        urgent: { type: "array", items: SUMMARY_ITEM_SCHEMA },
        important: { type: "array", items: SUMMARY_ITEM_SCHEMA },
        info: { type: "array", items: SUMMARY_ITEM_SCHEMA },
        other: { type: "array", items: SUMMARY_ITEM_SCHEMA },
      },
      required: ["overview", "urgent", "important", "info", "other"],
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          startTime: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
          endTime: { type: "string" },
          location: { type: "string" },
          description: { type: "string" },
          sourceEmailId: { type: "string" },
          confidence: { type: "string", enum: ["haute", "moyenne", "basse"] },
        },
        required: [
          "title",
          "date",
          "startTime",
          "endTime",
          "location",
          "description",
          "sourceEmailId",
          "confidence",
        ],
      },
    },
  },
  required: ["summary", "events"],
};

// Version generique acceptant une liste de messages et un format optionnel
// ("json" pour forcer du JSON strict, omis pour une reponse texte libre --
// utilisee par le chatbot mailbox).
async function callOllamaChat({ baseUrl, model, messages, format, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/chat`;

  let response;
  try {
    response = await withAbortTimeout(timeoutMs, (signal) => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        ...(format ? { format } : {}),
        messages,
      }),
    }));
  } catch (e) {
    if (isAbortError(e)) {
      throw new LlmCallError(
        `Timeout apres ${timeoutSeconds(timeoutMs)}s en contactant Ollama sur ${baseUrl}. ` +
          `Verifie qu'Ollama tourne (\`ollama serve\`) et que le modele "${model}" est disponible.`,
        { code: "timeout" }
      );
    }
    throw new LlmCallError(
      `Impossible de contacter Ollama sur ${baseUrl}. Verifie qu'Ollama est demarre.`,
      { cause: e, code: "network" }
    );
  }

  if (response.status === 404) {
    throw new LlmCallError(
      `Modele "${model}" introuvable sur Ollama. Lance \`ollama pull ${model}\` puis reessaie.`,
      { code: "model" }
    );
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new LlmCallError(
      `Ollama a repondu avec le statut ${response.status}. ${bodyText.slice(0, 300)}`
    );
  }

  const data = await response.json().catch((e) => {
    throw new LlmCallError("Reponse Ollama non-JSON inattendue.", { cause: e });
  });

  const content = data?.message?.content;
  if (!content) {
    throw new LlmCallError("Reponse Ollama sans contenu exploitable.");
  }
  return content;
}

async function listOllamaModels({ baseUrl, timeoutMs = 20_000 }) {
  let response;
  try {
    response = await withAbortTimeout(timeoutMs, (signal) =>
      fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { method: "GET", signal })
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw new LlmCallError(`Timeout apres ${timeoutSeconds(timeoutMs)}s.`, {
        code: "timeout",
      });
    }
    throw new LlmCallError(`Impossible de contacter Ollama sur ${baseUrl}.`, {
      cause: error,
      code: "network",
    });
  }

  if (!response.ok) {
    throw new LlmCallError(`Impossible de lister les modeles Ollama (${response.status}).`);
  }
  const data = await response.json().catch((error) => {
    throw new LlmCallError("Reponse Ollama non-JSON lors de la lecture des modeles.", {
      cause: error,
      code: "invalid_response",
    });
  });
  if (!Array.isArray(data?.models)) {
    throw new LlmCallError("La reponse Ollama ne contient pas de liste de modeles.", {
      code: "invalid_response",
    });
  }
  return data.models
    .map((model) => model?.model || model?.name)
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => name.trim());
}
