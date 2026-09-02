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
        // Message et pile compris : quand Thunderbird remplace l'erreur par
        // « An unexpected error occurred », le journal du background est le
        // seul endroit ou la cause reelle subsiste.
        logger.error("Operation en echec", {
          type: message.type,
          code: appError.code,
          reason: appError.message,
          stack: appError.cause?.stack || appError.stack,
        });
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
        logger.error("Operation en echec", {
          type,
          code: appError.code,
          reason: appError.message,
          stack: appError.cause?.stack || appError.stack,
        });
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

/**
 * Operation courte : un aller-retour, pas de progression.
 *
 * Thunderbird peut avoir suspendu la page d'arriere-plan entre deux messages.
 * Le premier envoi la reveille mais echoue parfois avec une erreur de
 * plate-forme opaque — « An unexpected error occurred » — qui ne dit rien de
 * l'operation. Un seul nouvel essai suffit alors, la page etant desormais
 * vivante.
 */
export async function call(type, payload = {}, { retry = true } = {}) {
  let response;
  try {
    response = await runtime().sendMessage({ channel: PORT_NAME, type, payload });
  } catch (error) {
    if (retry) {
      logger.debug("Service endormi, nouvel essai", { type });
      return call(type, payload, { retry: false });
    }
    throw new AppError(
      `Le service de Madame Michu ne repond pas (${error?.message || "cause inconnue"}). `
        + "Redemarre Thunderbird si cela persiste.",
      { code: "internal", cause: error }
    );
  }
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
      const interrupted = [...pending.values()];
      pending.clear();
      port = null;
      for (const entry of interrupted) {
        // Une page d'arriere-plan suspendue coupe le port sans prevenir. Se
        // reconnecter la reveille : on rejoue la demande une fois plutot que
        // de renvoyer un echec que l'utilisateur ne peut pas comprendre.
        if (entry.canRetry) {
          logger.debug("Port coupe, nouvel essai", { type: entry.type });
          send({ ...entry, canRetry: false });
        } else {
          entry.reject(new AppError(
            "Le service de Madame Michu s'est interrompu. Reessaie ; "
              + "si cela se repete, redemarre Thunderbird.",
            { code: "internal" }
          ));
        }
      }
    });
    return port;
  };

  /** Envoie — ou renvoie — une demande sur le port courant. */
  function send(entry) {
    const channel = connect();
    pending.set(entry.requestId, entry);
    try {
      channel.postMessage({ requestId: entry.requestId, type: entry.type, payload: entry.payload });
    } catch (error) {
      pending.delete(entry.requestId);
      entry.reject(new AppError("Impossible de joindre le service.", { code: "internal", cause: error }));
    }
  }

  return {
    /** @returns {{ promise: Promise<any>, abort: () => void }} */
    request(type, payload = {}, onProgress) {
      const requestId = crypto.randomUUID();
      const promise = new Promise((resolve, reject) => {
        send({ requestId, type, payload, onProgress, resolve, reject, canRetry: true });
      });
      return {
        promise,
        abort: () => {
          try {
            port?.postMessage({ requestId, kind: "abort" });
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
