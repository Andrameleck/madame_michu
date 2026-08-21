// La sidebar et la page d'options envoient leurs premiers messages des la fin de
// leur chargement. Au premier lancement, la page d'arriere-plan MV3 n'est pas
// encore joignable : l'envoi echoue avec "Receiving end does not exist" sans que
// le message soit jamais parti. L'attente doit couvrir un demarrage a froid, que
// l'Experiment API assistantCalendar rend nettement plus lent que le chargement
// d'une simple page d'extension.
const BACKGROUND_WAKE_TIMEOUT_MS = 20_000;
const BACKGROUND_WAKE_FIRST_DELAY_MS = 200;
const BACKGROUND_WAKE_MAX_DELAY_MS = 2_000;

function isBackgroundUnreachable(error) {
  return /receiving end does not exist|could not establish connection|message port closed/i
    .test(error?.message || "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Nomme l'appel en echec : sans cela, les trois messages envoyes au chargement
// produisent le meme texte et rien ne dit lequel a echoue.
function backgroundUnreachableError(message, attempts) {
  return new Error(
    `L'arriere-plan n'a pas repondu a ${message?.type || "ce message"} apres ` +
    `${attempts} tentative(s). Ouvre about:debugging puis "Inspecter" sur ` +
    `l'extension pour lire son erreur de demarrage.`
  );
}

// Le renvoi ne concerne que le canal injoignable, jamais une erreur metier : un
// profil LLM absent ou un provider en timeout doit remonter immediatement, sans
// declencher plusieurs generations de resume.
async function sendToBackground(message, { wakeTimeoutMs = BACKGROUND_WAKE_TIMEOUT_MS } = {}) {
  const giveUpAt = Date.now() + wakeTimeoutMs;
  let wait = BACKGROUND_WAKE_FIRST_DELAY_MS;

  for (let attempt = 1; ; attempt++) {
    try {
      return await messenger.runtime.sendMessage(message);
    } catch (error) {
      if (!isBackgroundUnreachable(error)) throw error;
      if (Date.now() + wait >= giveUpAt) throw backgroundUnreachableError(message, attempt);
      await delay(wait);
      wait = Math.min(wait * 2, BACKGROUND_WAKE_MAX_DELAY_MS);
    }
  }
}

// Les appels longs passent par un Port : Thunderbird conserve ainsi le contexte
// d'arriere-plan et ne ferme pas le canal pendant un appel LLM de plusieurs minutes.
function sendToBackgroundPort(message, {
  portName,
  timeoutMs,
  keepAliveMs = 10_000,
  timeoutMessage = "L'operation prend trop de temps.",
} = {}) {
  return new Promise((resolve, reject) => {
    let port;
    let settled = false;
    let timeoutId;
    let keepAliveId;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (keepAliveId) clearInterval(keepAliveId);
      try { port?.disconnect(); } catch (_) {}
      callback(value);
    };

    try {
      port = messenger.runtime.connect({ name: portName });
      port.onMessage.addListener((response) => {
        if (response?.type === "KEEPALIVE_ACK") return;
        if (response?.ok) {
          finish(resolve, response.result);
          return;
        }
        finish(reject, new Error(response?.error?.message || "L'arriere-plan a refuse l'operation."));
      });
      port.onDisconnect.addListener(() => {
        finish(reject, new Error(
          "La connexion avec le generateur de rapports a ete interrompue. " +
          "Relance Thunderbird puis reessaie."
        ));
      });
      timeoutId = setTimeout(() => finish(reject, new Error(timeoutMessage)), timeoutMs);
      port.postMessage(message);
      keepAliveId = setInterval(() => {
        try {
          port.postMessage({ type: "KEEPALIVE" });
        } catch (_) {
          finish(reject, new Error("Le generateur de rapports ne repond plus."));
        }
      }, keepAliveMs);
    } catch (error) {
      finish(reject, error);
    }
  });
}
