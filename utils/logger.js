// Logger centralise qui masque systematiquement les cles API et tout champ sensible
// avant d'ecrire quoi que ce soit dans la console, pour eviter les fuites en cas
// de partage de logs par l'utilisateur.

const SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "accesstoken",
  "refreshtoken",
]);

function maskSecret(value) {
  if (typeof value !== "string") return "***";
  return value.length > 8 ? `${value.slice(0, 3)}***${value.slice(-2)}` : "***";
}

// `seen` protege des references circulaires : un objet Thunderbird ou une erreur
// chainee suffisait sinon a faire deborder la pile depuis un simple logger.warn.
function redact(value, key = "", seen = new WeakSet()) {
  if (value == null) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value === "string") {
    if (typeof key === "string" && SENSITIVE_KEYS.has(key.toLowerCase())) return maskSecret(value);
    return value.replace(/Bearer\s+[^\s]+/gi, "Bearer ***");
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[circulaire]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, "", seen));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = redact(v, k, seen);
  }
  return out;
}

const PREFIX = "[AssistantMailIA]";

const logger = {
  debug(...args) {
    console.debug(PREFIX, ...args.map((value) => redact(value)));
  },
  info(...args) {
    console.info(PREFIX, ...args.map((value) => redact(value)));
  },
  warn(...args) {
    console.warn(PREFIX, ...args.map((value) => redact(value)));
  },
  error(...args) {
    console.error(PREFIX, ...args.map((value) => redact(value)));
  },
};
