// Declenchements automatiques. Le rapport quotidien a une heure fixe, le
// rafraichissement periodique du rapport du jour, et rien d'autre : chaque
// alarme supplementaire est un appel LLM que l'utilisateur n'a pas demande.

import { createLogger } from "../core/logger.js";
import { loadConfig } from "../core/settings.js";
import { generateReport } from "../features/reports/service.js";

const logger = createLogger("scheduler");

const DAILY_ALARM = "michu-daily-report";
const REFRESH_ALARM = "michu-refresh";

function alarms() {
  return typeof messenger !== "undefined" ? messenger.alarms : null;
}

function nextOccurrence(hour, minute, now = new Date()) {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

/** (Re)programme les alarmes a partir de la configuration courante. */
export async function scheduleAlarms(config) {
  const api = alarms();
  if (!api) return;
  const settings = config || (await loadConfig());
  await api.clear(DAILY_ALARM).catch(() => {});
  await api.clear(REFRESH_ALARM).catch(() => {});

  api.create(DAILY_ALARM, {
    when: nextOccurrence(settings.reports.hour, settings.reports.minute),
    periodInMinutes: 24 * 60,
  });
  if (settings.reports.autoRefreshMinutes > 0) {
    api.create(REFRESH_ALARM, { periodInMinutes: settings.reports.autoRefreshMinutes });
  }
  logger.info("Alarmes programmees", {
    heure: `${settings.reports.hour}:${String(settings.reports.minute).padStart(2, "0")}`,
    rafraichissement: settings.reports.autoRefreshMinutes,
  });
}

/** Branche l'execution des alarmes. A appeler une seule fois au demarrage. */
export function registerAlarmHandlers() {
  const api = alarms();
  if (!api) return;
  api.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== DAILY_ALARM && alarm.name !== REFRESH_ALARM) return;
    try {
      // Le rapport du jour est le seul regenere automatiquement : les periodes
      // longues coutent cher et changent peu.
      await generateReport("day", { force: alarm.name === DAILY_ALARM });
      logger.info("Rapport automatique produit", { alarme: alarm.name });
    } catch (error) {
      logger.warn("Rapport automatique impossible", { reason: error.message });
    }
  });
}
