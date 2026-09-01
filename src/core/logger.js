// Journal unique de l'extension. Toute valeur journalisee traverse la redaction :
// un secret ou un extrait de mail ne doit jamais atterrir dans la console, dans
// une URL ou dans un message d'erreur affiche.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const SECRET_KEY_PATTERN = /(api[-_]?key|secret|token|password|authorization|refresh|access|bearer)/i;
// Champs dont la valeur est du contenu utilisateur : on garde la taille, pas le texte.
const CONTENT_KEY_PATTERN = /(body|content|snippet|text|subject|answer|prompt|message|excerpt)/i;

let currentLevel = LEVELS.info;
let sink = console;

export function setLogLevel(level) {
  currentLevel = LEVELS[level] ?? LEVELS.info;
}

/** Point d'injection pour les tests : remplace la console cible. */
export function setLogSink(nextSink) {
  sink = nextSink || console;
}

export function redact(value, keyHint = "") {
  if (value == null) return value;
  if (SECRET_KEY_PATTERN.test(keyHint)) return "[secret]";
  if (typeof value === "string") {
    if (CONTENT_KEY_PATTERN.test(keyHint)) return `[${value.length} caracteres]`;
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    // Une liste longue n'apporte rien au diagnostic : on en garde la mesure.
    return value.length > 10 ? `[${value.length} elements]` : value.map((item) => redact(item, keyHint));
  }
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code };
  const output = {};
  for (const [key, item] of Object.entries(value)) output[key] = redact(item, key);
  return output;
}

function emit(level, scope, message, context) {
  if (LEVELS[level] < currentLevel) return;
  const line = `[michu:${scope}] ${message}`;
  const method = sink[level] ? level : "log";
  if (context === undefined) sink[method](line);
  else sink[method](line, redact(context));
}

/** Cree un journal portant le nom du module appelant. */
export function createLogger(scope) {
  return {
    debug: (message, context) => emit("debug", scope, message, context),
    info: (message, context) => emit("info", scope, message, context),
    warn: (message, context) => emit("warn", scope, message, context),
    error: (message, context) => emit("error", scope, message, context),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}
