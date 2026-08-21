// Planification de la notification quotidienne et des actualisations silencieuses.

const DAILY_ALARM_NAME = "assistant-mail-ia-daily-summary";
const REFRESH_ALARM_NAME = "assistant-mail-ia-periodic-refresh";

async function scheduleSummaryAlarms() {
  const { summaryHour, summaryMinute, autoRefreshMinutes } = await getSettings();

  await messenger.alarms.clear(DAILY_ALARM_NAME);
  await messenger.alarms.clear(REFRESH_ALARM_NAME);

  const when = nextOccurrence(summaryHour, summaryMinute);
  await messenger.alarms.create(DAILY_ALARM_NAME, {
    when,
    periodInMinutes: 24 * 60,
  });

  logger.info(`Alarme quotidienne programmee pour ${new Date(when).toLocaleString()}`);

  if (autoRefreshMinutes > 0) {
    await messenger.alarms.create(REFRESH_ALARM_NAME, {
      when: Date.now() + autoRefreshMinutes * 60 * 1000,
      periodInMinutes: autoRefreshMinutes,
    });
    logger.info(`Actualisation silencieuse programmee toutes les ${autoRefreshMinutes} minutes`);
  }
}

function nextOccurrence(hour, minute) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function onSummaryAlarm(callback) {
  messenger.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DAILY_ALARM_NAME) callback({ notify: true, kind: "daily" });
    if (alarm.name === REFRESH_ALARM_NAME) callback({ notify: false, kind: "refresh" });
  });
}
