// Planification de la generation automatique quotidienne via messenger.alarms.

const DAILY_ALARM_NAME = "assistant-mail-ia-daily-summary";

async function scheduleDailySummary() {
  const { summaryHour, summaryMinute } = await getSettings();

  await messenger.alarms.clear(DAILY_ALARM_NAME);

  const when = nextOccurrence(summaryHour, summaryMinute);
  await messenger.alarms.create(DAILY_ALARM_NAME, {
    when,
    periodInMinutes: 24 * 60,
  });

  logger.info(`Alarme quotidienne programmee pour ${new Date(when).toLocaleString()}`);
}

function nextOccurrence(hour, minute) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function onDailyAlarm(callback) {
  messenger.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DAILY_ALARM_NAME) callback();
  });
}
