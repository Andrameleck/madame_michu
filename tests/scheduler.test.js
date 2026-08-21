const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadScheduler(autoRefreshMinutes) {
  const created = [];
  const cleared = [];
  let alarmListener;
  const context = vm.createContext({
    Date,
    getSettings: async () => ({ summaryHour: 8, summaryMinute: 0, autoRefreshMinutes }),
    logger: { info() {} },
    messenger: {
      alarms: {
        clear: async (name) => cleared.push(name),
        create: async (name, options) => created.push({ name, options }),
        onAlarm: { addListener: (listener) => (alarmListener = listener) },
      },
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "scheduler.js"), "utf8"),
    context
  );
  return { context, created, cleared, getAlarmListener: () => alarmListener };
}

test("programme une notification quotidienne et une actualisation horaire", async () => {
  const scheduler = loadScheduler(60);

  await vm.runInContext("scheduleSummaryAlarms()", scheduler.context);

  assert.deepEqual(scheduler.cleared, [
    "assistant-mail-ia-daily-summary",
    "assistant-mail-ia-periodic-refresh",
  ]);
  assert.equal(scheduler.created[0].options.periodInMinutes, 24 * 60);
  assert.equal(scheduler.created[1].name, "assistant-mail-ia-periodic-refresh");
  assert.equal(scheduler.created[1].options.periodInMinutes, 60);
});

test("ne programme pas l'actualisation periodique lorsqu'elle est desactivee", async () => {
  const scheduler = loadScheduler(0);

  await vm.runInContext("scheduleSummaryAlarms()", scheduler.context);

  assert.equal(scheduler.created.length, 1);
  assert.equal(scheduler.created[0].name, "assistant-mail-ia-daily-summary");
});

test("distingue la notification quotidienne de l'actualisation silencieuse", () => {
  const scheduler = loadScheduler(60);
  const received = [];
  scheduler.context.callback = (options) => received.push(options);
  vm.runInContext("onSummaryAlarm(callback)", scheduler.context);

  scheduler.getAlarmListener()({ name: "assistant-mail-ia-daily-summary" });
  scheduler.getAlarmListener()({ name: "assistant-mail-ia-periodic-refresh" });

  assert.deepEqual(JSON.parse(JSON.stringify(received)), [
    { notify: true, kind: "daily" },
    { notify: false, kind: "refresh" },
  ]);
});
