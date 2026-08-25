const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "background", "weatherService.js"), "utf8");

test("recupere la meteo sans recevoir de donnees de messagerie", async () => {
  const requestedUrls = [];
  const stored = {};
  const context = vm.createContext({
    Date, URL, AbortController, setTimeout, clearTimeout,
    getSettings: async () => ({ uiLanguage: "fr" }),
    messenger: { storage: { local: {
      get: async (defaults) => ({ ...defaults, ...stored }),
      set: async (values) => Object.assign(stored, values),
    } } },
    fetch: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes("geocoding-api")) {
        return { ok: true, json: async () => ({ results: [{ name: "Montpellier", country: "France", latitude: 43.61, longitude: 3.88 }] }) };
      }
      return { ok: true, json: async () => ({
        current: { time: "2026-08-25T10:00", temperature_2m: 24.2, weather_code: 1, pressure_msl: 1015 },
        hourly: {
          time: ["2026-08-25T10:00", "2026-08-25T14:00", "2026-08-25T15:00", "2026-08-25T16:00"],
          temperature_2m: [24.2, 27, 28, 27],
          weather_code: [1, 2, 3, 61],
        },
        daily: { temperature_2m_min: [18], temperature_2m_max: [29], precipitation_probability_max: [10] },
      }) };
    },
  });
  vm.runInContext(source, context);
  const weather = await vm.runInContext("getSidebarWeather()", context);
  assert.equal(weather.location, "Montpellier, France");
  assert.equal(weather.temperature, 24.2);
  assert.equal(weather.trend.time, "2026-08-25T15:00");
  assert.equal(weather.trend.icon, "⛅");
  assert.equal(weather.trend.temperature, 28);
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[0], /name=Montpellier/);
  assert.equal(JSON.stringify(requestedUrls).includes("mail"), false);

  await vm.runInContext("getSidebarWeather()", context);
  assert.equal(requestedUrls.length, 2, "la seconde lecture doit utiliser le cache local");
});

test("utilise Montpellier par defaut sans option utilisateur", () => {
  assert.match(source, /DEFAULT_WEATHER_LOCATION = "Montpellier, France"/);
  assert.doesNotMatch(source, /settings\.weatherEnabled|settings\.weatherLocation|status: "setup"/);
});
