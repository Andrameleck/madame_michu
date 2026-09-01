// Point d'entree unique vers les LLM. Le reste de l'application ne connait que
// ce module : elle envoie des messages et des outils, elle recoit une reponse
// normalisee. Tout ce qui differe d'un fournisseur a l'autre — dialecte, cle,
// OAuth, support des outils, ordre de repli — est resolu ici.

import { AppError, ConfigurationError, ProviderError, toAppError } from "../core/errors.js";
import { createLogger } from "../core/logger.js";
import { getSecret, loadConfig, setSecret } from "../core/settings.js";
import { getProvider } from "./registry.js";
import { sendsDataOutside } from "./endpointPolicy.js";
import { hasOriginPermission, originPattern } from "../core/permissions.js";
import { emulateRequest, looksLikeToolRejection, parseEmulatedResponse } from "./toolEmulation.js";

const logger = createLogger("llm");

export const TIMEOUTS = Object.freeze({
  chat: 60_000,
  tool: 60_000,
  report: 120_000,
  probe: 20_000,
});

// Ce qu'on a appris a l'usage d'un couple profil/modele, pour ne pas repeter un
// aller-retour perdu a chaque tour. Volontairement non persiste : un modele mis
// a jour retrouve ses capacites au prochain demarrage.
const learnedToolMode = new Map();

function toolModeKey(profile) {
  return `${profile.id}:${profile.model}`;
}

/** Construit le contexte transmis a l'adaptateur : profil + secret resolus. */
export async function buildContext(profile) {
  const descriptor = getProvider(profile.provider);
  if (!descriptor) {
    throw new ConfigurationError(`Fournisseur inconnu : ${profile.provider}.`);
  }
  const secret = await getSecret(profile.id);
  if (descriptor.auth === "api-key" && !secret.apiKey) {
    throw new ConfigurationError(`Le profil « ${profile.label} » attend une cle API.`);
  }
  return {
    profileId: profile.id,
    label: profile.label,
    baseUrl: profile.baseUrl || descriptor.defaultBaseUrl,
    model: profile.model,
    apiKey: secret.apiKey || "",
    credentials: secret.oauth || {},
    options: profile.options || {},
    descriptor,
    saveCredentials: (credentials) => setSecret(profile.id, { oauth: credentials }),
  };
}

/** Profils actifs, dans leur ordre de priorite. */
export function activeProfiles(config) {
  return (config.llm?.profiles || []).filter((profile) => profile.enabled !== false);
}

async function assertUsable(config, descriptor, profile) {
  if (!sendsDataOutside(descriptor, profile.baseUrl)) return;
  if (config.privacy?.allowRemoteProviders !== true) {
    throw new ConfigurationError(
      `Le profil « ${profile.label} » envoie des donnees hors de ta machine. `
        + "Autorise les fournisseurs distants dans les options pour l'utiliser.",
      { code: "consent" }
    );
  }
  // Sans permission d'origine, l'appel echouerait en « service injoignable » :
  // le vrai diagnostic vaut mieux que la panne reseau apparente.
  const endpoint = profile.baseUrl || descriptor.defaultBaseUrl;
  if (!(await hasOriginPermission(endpoint))) {
    throw new ConfigurationError(
      `Thunderbird n'a pas l'autorisation de contacter ${originPattern(endpoint)}. `
        + "Ouvre les options et teste le profil pour accorder cette permission.",
      { code: "configuration" }
    );
  }
}

/**
 * Appelle un profil precis. Gere l'emulation d'outils et son apprentissage.
 * @param {object} profile
 * @param {import("./types.js").ChatRequest} request
 * @returns {Promise<import("./types.js").ChatResponse & { profileId: string, toolMode: string }>}
 */
export async function callProfile(profile, request) {
  const context = await buildContext(profile);
  const { descriptor } = context;
  const wantsTools = Boolean(request.tools?.length);

  let mode = learnedToolMode.get(toolModeKey(profile))
    || (descriptor.capabilities.tools === "native" ? "native" : "emulated");
  if (!wantsTools) mode = "native";

  if (request.responseSchema && !descriptor.capabilities.jsonSchema) {
    // Le fournisseur ne sait pas contraindre sa sortie. `chatJson` a deja
    // decrit le schema dans le prompt : on retire la contrainte native et la
    // validation en aval fera foi.
    request = { ...request, responseSchema: undefined };
  }

  const send = async (activeMode) => {
    const outgoing = activeMode === "emulated"
      ? emulateRequest(request, descriptor.capabilities)
      : request;
    const response = await descriptor.adapter.chat(context, outgoing);
    return activeMode === "emulated" && wantsTools
      ? parseEmulatedResponse(response, request.tools)
      : response;
  };

  try {
    const response = await send(mode);
    return { ...response, profileId: profile.id, toolMode: mode };
  } catch (error) {
    const appError = toAppError(error);
    if (mode === "native" && wantsTools && descriptor.capabilities.toolFallback
        && looksLikeToolRejection(appError)) {
      logger.info("Outils natifs refuses, bascule en mode emule", {
        profile: profile.label,
        model: profile.model,
      });
      learnedToolMode.set(toolModeKey(profile), "emulated");
      const response = await send("emulated");
      return { ...response, profileId: profile.id, toolMode: "emulated" };
    }
    throw appError;
  }
}

/**
 * Appelle le premier profil actif capable de repondre, puis les suivants tant
 * que l'echec est reessayable. Une erreur de configuration n'est pas rejouee
 * sur le meme profil : elle se reproduirait a l'identique.
 * @param {import("./types.js").ChatRequest} request
 * @param {{ config?: object }} [options]
 */
export async function chat(request, { config } = {}) {
  const settings = config || (await loadConfig());
  const profiles = activeProfiles(settings);
  if (!profiles.length) {
    throw new ConfigurationError(
      "Aucun profil LLM actif. Ajoute-en un dans les options de Madame Michu."
    );
  }

  const failures = [];
  for (const profile of profiles) {
    const descriptor = getProvider(profile.provider);
    try {
      await assertUsable(settings, descriptor, profile);
      const started = Date.now();
      const response = await callProfile(profile, {
        temperature: settings.llm?.temperature,
        timeoutMs: TIMEOUTS.chat,
        ...request,
      });
      logger.debug("Reponse LLM", {
        profile: profile.label,
        model: response.model,
        toolMode: response.toolMode,
        durationMs: Date.now() - started,
        toolCalls: response.toolCalls.length,
      });
      return response;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === "aborted") throw appError;
      failures.push({ profile: profile.label, code: appError.code, message: appError.message });
      logger.warn("Profil LLM en echec, passage au suivant", {
        profile: profile.label,
        code: appError.code,
      });
    }
  }

  throw new ProviderError(describeFailures(failures), {
    code: "server",
    details: { failures },
  });
}

function describeFailures(failures) {
  if (failures.length === 1) {
    return `Le seul profil LLM actif a echoue — ${failures[0].profile} : ${failures[0].message}`;
  }
  const lines = failures.map((failure) => `• ${failure.profile} : ${failure.message}`).join("\n");
  return `Aucun profil LLM n'a pu repondre.\n${lines}`;
}

/**
 * Demande une reponse conforme a un schema JSON et la renvoie deja parsee.
 * @param {import("./types.js").ChatRequest & { responseSchema: object }} request
 */
export async function chatJson(request, options) {
  // Le schema est aussi rappele dans le prompt : les fournisseurs qui savent le
  // faire respecter le recoivent nativement, les autres au moins par consigne.
  const messages = withSchemaInstruction(request.messages, request.responseSchema);
  const response = await chat({ timeoutMs: TIMEOUTS.report, ...request, messages }, options);
  const parsed = parseJsonPayload(response.text);
  if (parsed == null) {
    throw new ProviderError("Le modele n'a pas renvoye le JSON attendu.", {
      code: "invalid_response",
    });
  }
  return { ...response, data: parsed };
}

function withSchemaInstruction(messages, schema) {
  if (!schema) return messages;
  const instruction = "Reponds uniquement par un objet JSON valide conforme a ce schema, "
    + `sans texte autour et sans bloc de code :\n${JSON.stringify(schema)}`;
  const index = messages.findIndex((message) => message.role === "system");
  if (index < 0) return [{ role: "system", content: instruction }, ...messages];
  return messages.map((message, position) =>
    position === index ? { ...message, content: `${message.content}\n\n${instruction}` } : message
  );
}

function parseJsonPayload(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Liste les modeles proposes par un profil, pour la page d'options. */
export async function listModels(profile) {
  const context = await buildContext(profile);
  const models = await context.descriptor.adapter.listModels?.(context);
  return [...new Set(models || [])].sort((left, right) => left.localeCompare(right));
}

/** Teste un profil sans passer par la chaine de repli. */
export async function testProfile(profile, { config } = {}) {
  const settings = config || (await loadConfig());
  const started = Date.now();
  try {
    await assertUsable(settings, getProvider(profile.provider), profile);
    const response = await callProfile(profile, {
      messages: [{ role: "user", content: "Reponds uniquement par OK." }],
      timeoutMs: TIMEOUTS.probe,
    });
    return {
      ok: true,
      model: response.model,
      latencyMs: Date.now() - started,
      answer: response.text.slice(0, 80),
    };
  } catch (error) {
    const appError = error instanceof AppError ? error : toAppError(error);
    return { ok: false, code: appError.code, message: appError.message };
  }
}

/** Reinitialise ce que la gateway a appris (changement de modele, tests). */
export function resetLearnedCapabilities() {
  learnedToolMode.clear();
}
