// Plomberie HTTP commune aux adaptateurs : delai maximal, annulation par
// l'appelant, et surtout traduction des statuts HTTP en codes d'erreur stables.
// Sans cette traduction, la chaine de repli ne saurait pas distinguer une cle
// invalide (inutile de reessayer) d'une surcharge passagere (profil suivant).

import { AppError, ProviderError } from "../core/errors.js";

export const DEFAULT_TIMEOUT_MS = 90_000;

/** Enchaine le signal de l'appelant et le delai maximal en un seul AbortSignal. */
function linkSignals(timeoutMs, callerSignal) {
  const controller = new AbortController();
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forward = () => controller.abort();
  callerSignal?.addEventListener("abort", forward, { once: true });
  const release = () => {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", forward);
  };
  return { signal: controller.signal, state, release };
}

function errorCodeForStatus(status) {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "configuration";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "invalid_response";
}

/**
 * Envoie une requete et renvoie la `Response` brute, sans lever sur un statut
 * d'erreur. Reserve aux reponses non-JSON (flux SSE) ; partout ailleurs,
 * `requestJson` evite de dupliquer la traduction des statuts.
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: object, timeoutMs?: number,
 *           signal?: AbortSignal, label: string }} options
 */
export async function requestRaw(url, {
  method = "POST",
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal: callerSignal,
  label,
} = {}) {
  const { signal, state, release } = linkSignals(timeoutMs, callerSignal);
  try {
    return await fetch(url, {
      method,
      signal,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      if (state.timedOut) {
        throw new ProviderError(
          `${label} n'a pas repondu en ${Math.round(timeoutMs / 1000)} s.`,
          { code: "timeout", cause: error }
        );
      }
      throw new AppError("Operation interrompue.", { code: "aborted", cause: error });
    }
    throw new ProviderError(
      `Impossible de joindre ${label}. Verifie l'URL du service et ta connexion.`,
      { code: "network", cause: error, details: { url: originOf(url) } }
    );
  } finally {
    release();
  }
}

/** Traduit un statut HTTP en code d'erreur stable, pour les appels bruts. */
export function statusToErrorCode(status) {
  return errorCodeForStatus(status);
}

/**
 * Envoie une requete et renvoie la reponse JSON.
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: object, timeoutMs?: number,
 *           signal?: AbortSignal, label: string,
 *           describeError?: (payload: any, status: number) => string|undefined }} options
 */
export async function requestJson(url, {
  method = "POST",
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal: callerSignal,
  label,
  describeError,
} = {}) {
  const { signal, state, release } = linkSignals(timeoutMs, callerSignal);
  let response;
  try {
    response = await fetch(url, {
      method,
      signal,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      if (state.timedOut) {
        throw new ProviderError(
          `${label} n'a pas repondu en ${Math.round(timeoutMs / 1000)} s.`,
          { code: "timeout", cause: error }
        );
      }
      throw new AppError("Operation interrompue.", { code: "aborted", cause: error });
    }
    throw new ProviderError(
      `Impossible de joindre ${label}. Verifie l'URL du service et ta connexion.`,
      { code: "network", cause: error, details: { url: originOf(url) } }
    );
  } finally {
    release();
  }

  if (!response.ok) {
    const payload = await readBody(response);
    const detail = describeError?.(payload, response.status)
      || extractErrorMessage(payload)
      || `statut HTTP ${response.status}`;
    throw new ProviderError(`${label} a refuse la requete : ${detail}`, {
      code: errorCodeForStatus(response.status),
      details: { status: response.status },
    });
  }

  const payload = await readBody(response);
  if (typeof payload === "string") {
    throw new ProviderError(`${label} a renvoye une reponse non-JSON.`, {
      code: "invalid_response",
    });
  }
  return payload;
}

async function readBody(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

// Les quatre fournisseurs supportes emballent leur message d'erreur differemment.
// Aucun n'est garanti : on retombe toujours sur le statut HTTP.
function extractErrorMessage(payload) {
  if (!payload) return undefined;
  if (typeof payload === "string") return payload.slice(0, 300);
  const candidate = payload.error?.message || payload.error || payload.message || payload.detail;
  return typeof candidate === "string" ? candidate.slice(0, 300) : undefined;
}

/** Ne journalise jamais une URL complete : elle peut contenir un jeton. */
export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "url invalide";
  }
}

/** Concatene une base et un chemin sans jamais produire de double slash. */
export function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}
