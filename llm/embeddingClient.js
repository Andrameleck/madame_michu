// Connecteur pour le modele d'embedding Ollama (utilise pour indexer les mails
// et pour vectoriser les questions du chatbot). Meme principe que ollamaClient.js
// mais cible /api/embeddings.

const EMBEDDING_TIMEOUT_MS = 60_000;

async function callOllamaEmbedding({ baseUrl, model, text, timeoutMs = EMBEDDING_TIMEOUT_MS }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/embeddings`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model, prompt: text }),
    });
  } catch (e) {
    if (e.name === "AbortError") {
      throw new LlmCallError(
        `Timeout apres ${Math.round(timeoutMs / 1000)}s en contactant Ollama (embeddings) sur ${baseUrl}.`
      );
    }
    throw new LlmCallError(
      `Impossible de contacter Ollama (embeddings) sur ${baseUrl}. Verifie qu'Ollama est demarre.`,
      { cause: e }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    throw new LlmCallError(
      `Modele d'embedding "${model}" introuvable sur Ollama. Lance \`ollama pull ${model}\` puis reessaie.`
    );
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new LlmCallError(
      `Ollama (embeddings) a repondu avec le statut ${response.status}. ${bodyText.slice(0, 300)}`
    );
  }

  const data = await response.json().catch((e) => {
    throw new LlmCallError("Reponse Ollama (embeddings) non-JSON inattendue.", { cause: e });
  });

  if (!Array.isArray(data.embedding)) {
    throw new LlmCallError("Reponse Ollama (embeddings) sans vecteur exploitable.");
  }
  return data.embedding;
}
