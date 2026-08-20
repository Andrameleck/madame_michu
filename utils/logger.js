// Logger centralise qui masque systematiquement les cles API et tout champ sensible
// avant d'ecrire quoi que ce soit dans la console, pour eviter les fuites en cas
// de partage de logs par l'utilisateur.

const SENSITIVE_KEYS = ["apiKey", "api_key", "authorization", "token"];

function redact(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > 8 ? `${value.slice(0, 3)}***${value.slice(-2)}` : "***";
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.includes(k) ? redact(v) : v;
    }
    return out;
  }
  return value;
}

const PREFIX = "[AssistantMailIA]";

const logger = {
  debug(...args) {
    console.debug(PREFIX, ...args.map(redact));
  },
  info(...args) {
    console.info(PREFIX, ...args.map(redact));
  },
  warn(...args) {
    console.warn(PREFIX, ...args.map(redact));
  },
  error(...args) {
    console.error(PREFIX, ...args.map(redact));
  },
};
