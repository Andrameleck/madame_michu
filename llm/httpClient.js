// Plomberie partagee par tous les connecteurs LLM : type d'erreur commun et
// gestion du timeout. Chaque connecteur garde ses propres messages, seul le
// cablage AbortController/setTimeout, identique partout, est mutualise ici.

class LlmCallError extends Error {
  constructor(message, { cause, code } = {}) {
    super(message);
    this.name = "LlmCallError";
    this.cause = cause;
    this.code = code;
  }
}

// Execute `run(signal)` et l'abandonne apres timeoutMs. Le timer est toujours
// libere, y compris quand la requete echoue avant son echeance.
async function withAbortTimeout(timeoutMs, run) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function timeoutSeconds(timeoutMs) {
  return Math.round(timeoutMs / 1000);
}
