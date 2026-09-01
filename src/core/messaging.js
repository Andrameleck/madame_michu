// Canal unique entre le background et les pages d'interface.
//
// Deux modes coexistent, pour une raison concrete : un message ordinaire suffit
// aux operations courtes, mais Thunderbird peut suspendre la page d'arriere-plan
// pendant une generation longue. Les operations qui appellent un LLM passent
// donc par un port persistant, qui maintient le contexte vivant et permet en
// prime de rendre compte de l'avancement.

import { AppError, toAppError } from "./errors.js";
import { createLogger } from "./logger.js";

const logger = createLogger("bus");

export const PORT_NAME = "madame-michu";

function runtime() {
  if (typeof messenger === "undefined" || !messenger.runtime) {
    throw new AppError("L'API runtime de Thunderbird est indisponible.", { code: "internal" });
  }
  return messenger.runtime;
}

// -----------------------------------------------------------------------------
// Cote background
// -----------------------------------------------------------------------------

/**
 * Enregistre les gestionnaires d'operations.
 * @param {Record<string, (payload: object, context: { emit: (event: object) => void, signal: AbortSignal }) => Promise<any>>} handlers
 */
export function serve(handlers) {
  const dispatch = async (type, payload, context) => {
    const handler = handlers[type];
    if (!handler) throw new AppError(`Operation inconnue : ${type}`, { code: "internal" });
    return handler(payload || {}, context);
  };

  runtime().onMessage.addListener((message) => {
    if (!message?.type || message.channel !== PORT_NAME) return undefined;
    // Renvoyer une promesse (et non `true`) est la forme attendue cote Firefox.
    return dispatch(message.type, message.payload, {
      emit: () => {},
      signal: new AbortController().signal,
    })
      .then((data) => ({ ok: true, data }))
      .catch((error) => {
        const appError = toAppError(error);
        logger.warn("Operation en echec", { type: message.type, code: appError.code });
        return { ok: false, error: appError.toJSON() };
      });
  });

  runtime().onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    const controllers = new Map();

    port.onMessage.addListener(async (message) => {
      if (message?.kind === "abort") {
        controllers.get(message.requestId)?.abort();
        return;
      }
      const { requestId, type, payload } = message || {};
      if (!requestId || !type) return;
      const controller = new AbortController();
      controllers.set(requestId, controller);
      try {
        const data = await dispatch(type, payload, {
          emit: (event) => safePost(port, { requestId, kind: "progress", event }),
          signal: controller.signal,
        });
        safePost(port, { requestId, kind: "done", data });
      } catch (error) {
        const appError = toAppError(error);
        logger.warn("Operation en echec", { type, code: appError.code });
        safePost(port, { requestId, kind: "error", error: appError.toJSON() });
      } finally {
        controllers.delete(requestId);
      }
    });

    port.onDisconnect.addListener(() => {
      // La sidebar a ete fermee : inutile de continuer a payer un appel LLM.
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    });
  });
}

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch (error) {
    logger.debug("Port ferme avant l'envoi", { reason: error.message });
  }
}

// -----------------------------------------------------------------------------
// Cote interface
// -----------------------------------------------------------------------------

/** Operation courte : un aller-retour, pas de progression. */
export async function call(type, payload = {}) {
  const response = await runtime().sendMessage({ channel: PORT_NAME, type, payload });
  if (!response) throw new AppError("Le service n'a pas repondu.", { code: "internal" });
  if (!response.ok) {
    throw new AppError(response.error?.message || "Operation impossible.", {
      code: response.error?.code,
      details: response.error?.details,
    });
  }
  return response.data;
}

/**
 * Client persistant pour les operations longues. Un seul port par page : les
 * requetes y sont multiplexees par identifiant.
 */
export function createClient() {
  let port = null;
  const pending = new Map();

  const connect = () => {
    if (port) return port;
    port = runtime().connect({ name: PORT_NAME });
    port.onMessage.addListener((message) => {
      const entry = pending.get(message?.requestId);
      if (!entry) return;
      if (message.kind === "progress") {
        entry.onProgress?.(message.event);
      } else if (message.kind === "done") {
        pending.delete(message.requestId);
        entry.resolve(message.data);
      } else if (message.kind === "error") {
        pending.delete(message.requestId);
        entry.reject(new AppError(message.error?.message || "Operation impossible.", {
          code: message.error?.code,
        }));
      }
    });
    port.onDisconnect.addListener(() => {
      for (const entry of pending.values()) {
        entry.reject(new AppError("Le service s'est interrompu.", { code: "internal" }));
      }
      pending.clear();
      port = null;
    });
    return port;
  };

  return {
    /** @returns {{ promise: Promise<any>, abort: () => void }} */
    request(type, payload = {}, onProgress) {
      const channel = connect();
      const requestId = crypto.randomUUID();
      const promise = new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject, onProgress });
        channel.postMessage({ requestId, type, payload });
      });
      return {
        promise,
        abort: () => {
          try {
            channel.postMessage({ requestId, kind: "abort" });
          } catch {
            // Port deja ferme : la promesse a ete rejetee par onDisconnect.
          }
        },
      };
    },
    disconnect() {
      port?.disconnect();
      port = null;
    },
  };
}
