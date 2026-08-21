// Connecteur pour le modele d'embedding Ollama (utilise pour indexer les mails
// et pour vectoriser les questions du chatbot). Meme principe que ollamaClient.js
// mais cible l'endpoint courant /api/embed.

const EMBEDDING_TIMEOUT_MS = 60_000;

async function callOllamaEmbedding({ baseUrl, model, text, timeoutMs = EMBEDDING_TIMEOUT_MS }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/embed`;

  let response;
  try {
    response = await withAbortTimeout(timeoutMs, (signal) => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ model, input: text }),
    }));
  } catch (e) {
    if (isAbortError(e)) {
      throw new LlmCallError(
        `Timeout apres ${timeoutSeconds(timeoutMs)}s en contactant Ollama (embeddings) sur ${baseUrl}.`,
        { code: "timeout" }
      );
    }
    throw new LlmCallError(
      `Impossible de contacter Ollama (embeddings) sur ${baseUrl}. Verifie qu'Ollama est demarre.`,
      { cause: e, code: "network" }
    );
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

  const embedding = data?.embeddings?.[0];
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new LlmCallError("Reponse Ollama (embeddings) sans vecteur exploitable.");
  }
  return embedding;
}
