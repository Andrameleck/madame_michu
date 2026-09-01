// Point d'entree unique du background. Il n'y a plus d'ordre de chargement a
// respecter dans le manifeste : les dependances sont declarees par les imports,
// et ce fichier ne fait que brancher les listeners.

import { createLogger, setLogLevel } from "../core/logger.js";
import { loadConfig } from "../core/settings.js";
import { serve } from "../core/messaging.js";
import { CHATGPT_OAUTH, completeAuthorization, flowForTab } from "../llm/auth/chatgptOAuth.js";
import { setSecret } from "../core/settings.js";
import { operations } from "./operations.js";
import { registerAlarmHandlers, scheduleAlarms } from "./scheduler.js";

const logger = createLogger("boot");

serve(operations);
registerAlarmHandlers();

// L'onglet de connexion ChatGPT n'a aucun moyen de nous parler : on observe son
// URL jusqu'a ce qu'elle atteigne le callback local.
if (typeof messenger !== "undefined" && messenger.tabs?.onUpdated) {
  messenger.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!changeInfo.url?.startsWith(CHATGPT_OAUTH.redirectUri)) return;
    const flow = flowForTab(tabId);
    if (!flow) return;
    try {
      await completeAuthorization(flow.profileId, changeInfo.url, (credentials) =>
        setSecret(flow.profileId, { oauth: credentials })
      );
      await messenger.tabs.remove(tabId).catch(() => {});
      logger.info("Compte ChatGPT connecte");
    } catch (error) {
      logger.warn("Callback OAuth refuse", { reason: error.message });
    }
  });
}

// Thunderbird n'expose pas de sidebar aux extensions : l'interface s'ouvre dans
// un onglet, comme n'importe quel espace de travail.
if (typeof messenger !== "undefined" && messenger.action?.onClicked) {
  messenger.action.onClicked.addListener(async () => {
    const url = messenger.runtime.getURL("src/ui/sidebar/sidebar.html");
    const [existing] = await messenger.tabs.query({ url });
    if (existing) await messenger.tabs.update(existing.id, { active: true });
    else await messenger.tabs.create({ url });
  });
}

async function boot() {
  const config = await loadConfig({ refresh: true });
  setLogLevel(config.llm.profiles.length ? "info" : "debug");
  await scheduleAlarms(config);
  logger.info("Madame Michu demarree", {
    profils: config.llm.profiles.length,
    langue: config.language,
  });
}

boot().catch((error) => logger.error("Demarrage incomplet", error));
