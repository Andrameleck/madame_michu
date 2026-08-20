// Connecteur pour un LLM local via Ollama (http://localhost:11434 par defaut).
// Pas de cle API necessaire ; le champ "apiKey" du storage reste reserve a un
// futur provider distant et n'est jamais utilise ici.

class LlmCallError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "LlmCallError";
    this.cause = cause;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function callOllama({ baseUrl, model, system, user, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/chat`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (e) {
    if (e.name === "AbortError") {
      throw new LlmCallError(
        `Timeout apres ${Math.round(timeoutMs / 1000)}s en contactant Ollama sur ${baseUrl}. ` +
          `Verifie qu'Ollama tourne (\`ollama serve\`) et que le modele "${model}" est disponible.`
      );
    }
    throw new LlmCallError(
      `Impossible de contacter Ollama sur ${baseUrl}. Verifie qu'Ollama est demarre.`,
      { cause: e }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    throw new LlmCallError(
      `Modele "${model}" introuvable sur Ollama. Lance \`ollama pull ${model}\` puis reessaie.`
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
