// Configuration de l'extension : schema unique, valeurs par defaut, validation
// et migration depuis la version 1. Aucun autre module ne lit le stockage de
// configuration directement, ce qui garantit qu'un reglage a une seule
// definition et une seule valeur par defaut.

import { ConfigurationError } from "./errors.js";
import { createLogger } from "./logger.js";
import { read, readMany, write } from "./storage.js";
import { getProvider, PROVIDERS } from "../llm/registry.js";
import { normalizeEndpoint } from "../llm/endpointPolicy.js";

const logger = createLogger("settings");

export const CONFIG_VERSION = 2;
const CONFIG_KEY = "config";
const SECRETS_KEY = "secrets";

/**
 * Configuration par defaut. La forme est volontairement sectionnee : chaque
 * fonctionnalite possede sa branche, et une branche inconnue est ignoree a la
 * lecture plutot que de polluer le reste.
 */
export const DEFAULT_CONFIG = Object.freeze({
  version: CONFIG_VERSION,
  language: "fr",

  llm: {
    // L'ordre du tableau est l'ordre de repli : le premier profil actif est
    // essaye en premier, le suivant prend le relais s'il echoue.
    profiles: [],
    temperature: 0.2,
    maxToolSteps: 6,
  },

  privacy: {
    // Tant que ce consentement est faux, aucun profil distant n'est appele.
    allowRemoteProviders: false,
  },

  mail: {
    allAccounts: true,
    accountIds: [],
    allFolders: false,
    folders: ["inbox"],
    maxMessagesPerRun: 200,
    maxBodyChars: 4000,
  },

  reports: {
    hour: 8,
    minute: 0,
    autoRefreshMinutes: 60,
  },

  calendar: {
    autoCreate: false,
    calendarId: "",
    minConfidence: "moyenne", // basse | moyenne | haute
    confirmBeforeWrite: true,
  },

  chat: {
    historyTurns: 12,
  },
});

/** Profil vierge, utilise par la page d'options a la creation. */
export function createProfile(providerId = "ollama") {
  const descriptor = getProvider(providerId) || PROVIDERS.ollama;
  return {
    id: `profile-${crypto.randomUUID()}`,
    label: descriptor.label,
    provider: descriptor.id,
    model: "",
    baseUrl: descriptor.defaultBaseUrl,
    enabled: true,
    options: {},
  };
}

/**
 * Valide un profil et renvoie sa forme canonique. Leve une ConfigurationError
 * explicite : c'est ce message que la page d'options affiche a l'utilisateur.
 */
export function normalizeProfile(raw) {
  const descriptor = getProvider(raw?.provider);
  if (!descriptor) {
    throw new ConfigurationError(`Fournisseur inconnu : ${raw?.provider ?? "(vide)"}.`);
  }
  const label = String(raw.label || descriptor.label).trim().slice(0, 60);
  const baseUrl = descriptor.fixedBaseUrl
    ? descriptor.defaultBaseUrl
    : normalizeEndpoint(raw.baseUrl || descriptor.defaultBaseUrl);
  const model = String(raw.model || "").trim();
  if (!model) {
    throw new ConfigurationError(`Le profil « ${label} » n'a pas de modele selectionne.`);
  }
  return {
    id: String(raw.id || `profile-${crypto.randomUUID()}`),
    label,
    provider: descriptor.id,
    model,
    baseUrl,
    enabled: raw.enabled !== false,
    options: { ...(raw.options || {}) },
  };
}

function mergeSection(defaults, stored) {
  if (!stored || typeof stored !== "object") return { ...defaults };
  const output = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (stored[key] !== undefined) output[key] = stored[key];
  }
  return output;
}

function mergeConfig(stored) {
  const output = { ...DEFAULT_CONFIG, version: CONFIG_VERSION };
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = mergeSection(value, stored?.[key]);
    } else if (stored?.[key] !== undefined) {
      output[key] = stored[key];
    }
  }
  output.language = stored?.language === "en" ? "en" : "fr";
  // Un profil corrompu ne doit pas rendre l'extension inutilisable : on ecarte
  // les entrees invalides et on garde les autres.
  output.llm.profiles = (Array.isArray(stored?.llm?.profiles) ? stored.llm.profiles : [])
    .map((profile) => {
      try {
        return normalizeProfile(profile);
      } catch (error) {
        logger.warn("Profil LLM ignore", { id: profile?.id, reason: error.message });
        return null;
      }
    })
    .filter(Boolean);
  return output;
}

let cache = null;

/** Charge la configuration, en migrant la version 1 au premier acces. */
export async function loadConfig({ refresh = false } = {}) {
  if (cache && !refresh) return cache;
  let stored = await read(CONFIG_KEY, null);
  if (!stored) {
    const migrated = await migrateLegacyConfig();
    stored = migrated || { version: CONFIG_VERSION };
  }
  cache = mergeConfig(stored);
  return cache;
}

/** Applique un patch section par section et persiste le resultat. */
export async function saveConfig(patch) {
  const current = await loadConfig();
  const next = { ...current };
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULT_CONFIG)) continue;
    const defaults = DEFAULT_CONFIG[key];
    next[key] = defaults && typeof defaults === "object" && !Array.isArray(defaults)
      ? { ...current[key], ...value }
      : value;
  }
  if (patch?.llm?.profiles) {
    next.llm.profiles = patch.llm.profiles.map(normalizeProfile);
  }
  next.version = CONFIG_VERSION;
  await write(CONFIG_KEY, next);
  cache = mergeConfig(next);
  return cache;
}

export function invalidateConfigCache() {
  cache = null;
}

// -----------------------------------------------------------------------------
// Secrets. Ils vivent dans une cle distincte : la configuration reste ainsi
// exportable et journalisable sans risque de fuite.
// -----------------------------------------------------------------------------

export async function getSecret(profileId) {
  const secrets = await read(SECRETS_KEY, {});
  return secrets?.[profileId] || {};
}

export async function setSecret(profileId, secret) {
  const secrets = (await read(SECRETS_KEY, {})) || {};
  await write(SECRETS_KEY, { ...secrets, [profileId]: { ...secrets[profileId], ...secret } });
}

export async function deleteSecret(profileId) {
  const secrets = (await read(SECRETS_KEY, {})) || {};
  delete secrets[profileId];
  await write(SECRETS_KEY, secrets);
}

/** Supprime les secrets orphelins apres suppression de profils. */
export async function pruneSecrets(profileIds) {
  const keep = new Set(profileIds);
  const secrets = (await read(SECRETS_KEY, {})) || {};
  const next = Object.fromEntries(Object.entries(secrets).filter(([id]) => keep.has(id)));
  await write(SECRETS_KEY, next);
}

// -----------------------------------------------------------------------------
// Migration depuis la version 1 (reglages a plat + llmProfiles + cles en clair).
// -----------------------------------------------------------------------------

const LEGACY_PROVIDER_MAP = {
  ollama: "ollama",
  "openai-compatible": "openai",
  anthropic: "anthropic",
  "openai-codex": "chatgpt",
};

const LEGACY_KEYS = [
  "llmProvider", "providerBaseUrl", "providerModel", "ollamaBaseUrl", "ollamaModel",
  "apiKey", "llmProfiles", "preferredProviderId", "openAiCodexCredentials",
  "summaryHour", "summaryMinute", "autoRefreshMinutes", "sourceAllAccounts",
  "sourceAccountIds", "scanAllFolders", "scanFolders", "minConfidence",
  "autoCreateEvents", "defaultCalendarId", "confirmWrites", "maxEmailsPerRun",
  "maxBodyChars", "remoteDataConsentAccepted", "uiLanguage",
];

/**
 * Reconstruit une configuration v2 a partir du stockage v1. Renvoie null si
 * aucune trace de l'ancienne version n'existe (installation neuve).
 */
export async function migrateLegacyConfig() {
  const legacy = await readLegacy();
  if (!legacy || !Object.keys(legacy).some((key) => legacy[key] !== undefined && legacy[key] !== null)) {
    return null;
  }

  const secrets = {};
  const profiles = [];
  const legacyProfiles = Array.isArray(legacy.llmProfiles) && legacy.llmProfiles.length
    ? legacy.llmProfiles
    : [{
        id: "legacy-primary",
        name: "Provider principal",
        type: legacy.llmProvider,
        baseUrl: legacy.providerBaseUrl || legacy.ollamaBaseUrl,
        model: legacy.providerModel || legacy.ollamaModel,
        apiKey: legacy.apiKey,
        enabled: true,
      }];

  for (const old of legacyProfiles) {
    const provider = LEGACY_PROVIDER_MAP[old?.type];
    if (!provider) continue;
    const id = String(old.id || `profile-${crypto.randomUUID()}`);
    try {
      profiles.push(normalizeProfile({
        id,
        label: old.name,
        provider,
        model: old.model,
        baseUrl: old.baseUrl,
        enabled: old.enabled !== false,
      }));
    } catch (error) {
      logger.warn("Profil v1 non migrable", { id, reason: error.message });
      continue;
    }
    if (old.apiKey) secrets[id] = { apiKey: old.apiKey };
    const credentials = legacy.openAiCodexCredentials?.[id];
    if (credentials?.refreshToken || credentials?.accessToken) {
      secrets[id] = { ...secrets[id], oauth: credentials };
    }
  }

  // Le profil prefere de la v1 devient simplement le premier de la liste.
  const preferred = profiles.findIndex((profile) => profile.id === legacy.preferredProviderId);
  if (preferred > 0) profiles.unshift(...profiles.splice(preferred, 1));

  const config = {
    version: CONFIG_VERSION,
    language: legacy.uiLanguage === "en" ? "en" : "fr",
    llm: { ...DEFAULT_CONFIG.llm, profiles },
    privacy: { allowRemoteProviders: legacy.remoteDataConsentAccepted === true },
    mail: {
      ...DEFAULT_CONFIG.mail,
      allAccounts: legacy.sourceAllAccounts !== false,
      accountIds: legacy.sourceAccountIds || [],
      allFolders: legacy.scanAllFolders === true,
      folders: legacy.scanFolders?.length ? legacy.scanFolders : DEFAULT_CONFIG.mail.folders,
      maxMessagesPerRun: legacy.maxEmailsPerRun || DEFAULT_CONFIG.mail.maxMessagesPerRun,
      maxBodyChars: legacy.maxBodyChars || DEFAULT_CONFIG.mail.maxBodyChars,
    },
    reports: {
      hour: legacy.summaryHour ?? DEFAULT_CONFIG.reports.hour,
      minute: legacy.summaryMinute ?? DEFAULT_CONFIG.reports.minute,
      autoRefreshMinutes: legacy.autoRefreshMinutes ?? DEFAULT_CONFIG.reports.autoRefreshMinutes,
    },
    calendar: {
      ...DEFAULT_CONFIG.calendar,
      autoCreate: legacy.autoCreateEvents === true,
      calendarId: legacy.defaultCalendarId || "",
      minConfidence: legacy.minConfidence || DEFAULT_CONFIG.calendar.minConfidence,
      confirmBeforeWrite: legacy.confirmWrites !== false,
    },
    chat: { ...DEFAULT_CONFIG.chat },
  };

  await write(CONFIG_KEY, config);
  if (Object.keys(secrets).length) await write(SECRETS_KEY, secrets);
  logger.info("Configuration v1 migree", { profiles: profiles.length });
  return config;
}

async function readLegacy() {
  const defaults = Object.fromEntries(LEGACY_KEYS.map((key) => [key, null]));
  const legacy = await readMany(defaults);
  return Object.values(legacy).some((value) => value !== null) ? legacy : null;
}
