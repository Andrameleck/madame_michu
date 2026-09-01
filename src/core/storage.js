// Facade sur messenger.storage.local. Deux raisons d'exister : offrir un point
// d'injection aux tests, et separer physiquement les secrets du reste de la
// configuration pour que celle-ci puisse etre journalisee ou exportee sans
// precaution particuliere.

const AREAS = ["config", "secrets", "state"];

let backend = null;

/** Backend par defaut : le stockage local de Thunderbird. */
function defaultBackend() {
  if (typeof messenger === "undefined" || !messenger?.storage?.local) {
    throw new Error("messenger.storage.local est indisponible dans ce contexte.");
  }
  return messenger.storage.local;
}

/** Remplace le backend (tests). Passer null retablit Thunderbird. */
export function setStorageBackend(nextBackend) {
  backend = nextBackend;
}

function area() {
  return backend || (backend = defaultBackend());
}

export async function read(key, fallback = null) {
  const stored = await area().get({ [key]: fallback });
  return stored[key];
}

export async function write(key, value) {
  await area().set({ [key]: value });
}

export async function readAll() {
  return area().get(Object.fromEntries(AREAS.map((key) => [key, null])));
}

/** Lit plusieurs cles en une seule requete. `defaults` porte les valeurs de repli. */
export async function readMany(defaults) {
  return area().get(defaults);
}

/** Stockage en memoire, suffisant pour les tests et le mode hors-Thunderbird. */
export function createMemoryBackend(initial = {}) {
  const data = { ...initial };
  return {
    async get(defaults) {
      if (typeof defaults === "string") return { [defaults]: data[defaults] };
      const output = {};
      for (const [key, fallback] of Object.entries(defaults || data)) {
        output[key] = key in data ? data[key] : fallback;
      }
      return output;
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of [].concat(keys)) delete data[key];
    },
    snapshot: () => ({ ...data }),
  };
}
