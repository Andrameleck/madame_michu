// Aller-retour complet entre l'interface et le background, sur un faux
// `messenger.runtime`. C'est le chemin qu'emprunte chaque question du chat :
// une rupture ici se manifeste par une interface qui ne repond plus, sans la
// moindre erreur visible.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { setLogLevel } from "../../src/core/logger.js";

setLogLevel("silent");

/** Paire de ports relies, comme ceux que Thunderbird fournit. */
function createPortPair(name) {
  const make = () => ({
    name,
    listeners: [],
    disconnectListeners: [],
    onMessage: { addListener(fn) { this.listeners ??= []; } },
    onDisconnect: { addListener(fn) {} },
  });
  const left = make();
  const right = make();
  for (const [port, peer] of [[left, right], [right, left]]) {
    const messageListeners = [];
    const disconnectListeners = [];
    port.onMessage = { addListener: (fn) => messageListeners.push(fn) };
    port.onDisconnect = { addListener: (fn) => disconnectListeners.push(fn) };
    port.deliver = (message) => messageListeners.forEach((fn) => fn(message));
    port.notifyDisconnect = () => disconnectListeners.forEach((fn) => fn(port));
    port.postMessage = (message) => {
      // Asynchrone comme le vrai canal : un test qui reussirait seulement en
      // synchrone masquerait un probleme d'ordonnancement.
      queueMicrotask(() => peer.deliver(structuredClone(message)));
    };
    port.disconnect = () => queueMicrotask(() => peer.notifyDisconnect());
  }
  return { client: left, server: right };
}

function installFakeRuntime() {
  const messageListeners = [];
  const connectListeners = [];
  globalThis.messenger = {
    runtime: {
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      onConnect: { addListener: (fn) => connectListeners.push(fn) },
      connect({ name }) {
        const { client, server } = createPortPair(name);
        connectListeners.forEach((fn) => fn(server));
        return client;
      },
      async sendMessage(message) {
        for (const fn of messageListeners) {
          const result = fn(message);
          if (result !== undefined) return result;
        }
        return undefined;
      },
    },
  };
}

let messaging;

beforeEach(async () => {
  installFakeRuntime();
  // Le module retient ses listeners : on le recharge pour repartir propre.
  messaging = await import(`../../src/core/messaging.js?t=${Math.random()}`);
});

test("une operation courte fait l'aller-retour", async () => {
  messaging.serve({ "chat.ask": async ({ question }) => ({ answer: `vu : ${question}` }) });
  const result = await messaging.call("chat.ask", { question: "quoi de neuf" });
  assert.deepEqual(result, { answer: "vu : quoi de neuf" });
});

test("une erreur du background remonte avec son code", async () => {
  const { ConfigurationError } = await import("../../src/core/errors.js");
  messaging.serve({
    "reports.generate": async () => {
      throw new ConfigurationError("Aucun profil LLM actif.");
    },
  });
  await assert.rejects(messaging.call("reports.generate", {}), (error) => {
    assert.equal(error.message, "Aucun profil LLM actif.");
    assert.equal(error.code, "configuration");
    return true;
  });
});

test("une operation inconnue est signalee au lieu d'etre ignoree", async () => {
  messaging.serve({});
  await assert.rejects(messaging.call("operation.fantome", {}), /Operation inconnue/);
});

test("le port persistant transporte la reponse et les etapes", async () => {
  messaging.serve({
    "chat.ask": async ({ question }, context) => {
      context.emit({ kind: "tool", tool: "search_mail" });
      context.emit({ kind: "tool", tool: "read_mail" });
      return { answer: `reponse a ${question}`, sources: [] };
    },
  });

  const client = messaging.createClient();
  const progress = [];
  const { promise } = client.request(
    "chat.ask",
    { conversationId: "c1", question: "ou est la facture" },
    (event) => progress.push(event.tool)
  );

  const result = await promise;
  assert.equal(result.answer, "reponse a ou est la facture");
  assert.deepEqual(progress, ["search_mail", "read_mail"]);
});

test("deux requetes simultanees ne se melangent pas", async () => {
  messaging.serve({
    "chat.ask": async ({ question }) => {
      // La seconde repond avant la premiere : le multiplexage doit tenir.
      if (question === "lente") await new Promise((resolve) => setTimeout(resolve, 20));
      return { answer: question };
    },
    "reports.generate": async () => ({ range: "day", entries: [] }),
  });

  const client = messaging.createClient();
  const slow = client.request("chat.ask", { question: "lente" }).promise;
  const fast = client.request("chat.ask", { question: "rapide" }).promise;
  const report = client.request("reports.generate", { range: "day" }).promise;

  assert.deepEqual(await Promise.all([slow, fast, report]), [
    { answer: "lente" },
    { answer: "rapide" },
    { range: "day", entries: [] },
  ]);
});

test("une generation de rapport en cours n'empeche pas une question", async () => {
  let releaseReport;
  messaging.serve({
    "reports.generate": () => new Promise((resolve) => { releaseReport = resolve; }),
    "chat.ask": async () => ({ answer: "je reponds quand meme" }),
  });

  const client = messaging.createClient();
  const report = client.request("reports.generate", { range: "day" }).promise;
  const answer = await client.request("chat.ask", { question: "coucou" }).promise;

  assert.equal(answer.answer, "je reponds quand meme");
  releaseReport({ range: "day" });
  await report;
});

test("l'abandon d'une requete parvient au gestionnaire", async () => {
  let observed = null;
  messaging.serve({
    "chat.ask": (payload, context) => new Promise((resolve, reject) => {
      context.signal.addEventListener("abort", () => {
        observed = "aborted";
        reject(new Error("interrompu"));
      });
    }),
  });

  const client = messaging.createClient();
  const { promise, abort } = client.request("chat.ask", { question: "longue" });
  const settled = promise.catch((error) => error.message);
  await new Promise((resolve) => setTimeout(resolve, 5));
  abort();

  assert.equal(await settled, "interrompu");
  assert.equal(observed, "aborted");
});
