// Hierarchie d'erreurs commune. Chaque erreur porte un `code` stable : c'est lui
// que l'interface et la chaine de repli consultent, jamais le message, qui reste
// destine a l'utilisateur et peut etre traduit ou reformule sans rien casser.

/** @typedef {"configuration"|"auth"|"consent"|"network"|"timeout"|"rate_limit"|"server"|"invalid_response"|"unsupported"|"aborted"|"internal"} ErrorCode */

export class AppError extends Error {
  /**
   * @param {string} message message lisible par l'utilisateur, sans donnee sensible
   * @param {{ code?: ErrorCode, cause?: unknown, details?: object, retryable?: boolean }} [options]
   */
  constructor(message, { code = "internal", cause, details, retryable } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.cause = cause;
    this.details = details;
    // Un echec reessayable justifie de passer au profil suivant. Une erreur de
    // configuration, elle, se reproduira a l'identique : inutile d'insister.
    this.retryable = retryable ?? RETRYABLE_CODES.has(code);
  }

  /** Forme serialisable pour traverser la frontiere background/UI. */
  toJSON() {
    return { name: this.name, message: this.message, code: this.code, details: this.details };
  }
}

const RETRYABLE_CODES = new Set(["network", "timeout", "rate_limit", "server"]);

/** Le profil ou le reglage est incomplet ou invalide. */
export class ConfigurationError extends AppError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code ?? "configuration" });
  }
}

/** Le fournisseur LLM a refuse, echoue ou repondu quelque chose d'inexploitable. */
export class ProviderError extends AppError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code ?? "server" });
  }
}

/** Une operation Thunderbird (mail, calendrier) a echoue. */
export class HostError extends AppError {}

/** Normalise n'importe quelle valeur levee en AppError. */
export function toAppError(value, fallbackMessage = "Une erreur inattendue est survenue.") {
  if (value instanceof AppError) return value;
  if (value?.name === "AbortError") {
    return new AppError("Operation interrompue.", { code: "aborted", cause: value });
  }
  if (value instanceof Error) {
    return new AppError(value.message || fallbackMessage, { code: "internal", cause: value });
  }
  return new AppError(fallbackMessage, { code: "internal", details: { value: String(value) } });
}
