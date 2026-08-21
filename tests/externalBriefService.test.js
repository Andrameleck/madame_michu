const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadService(fetch) {
  const context = vm.createContext({
    fetch,
    URL,
    AbortController,
    Date,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "background", "externalBriefService.js"), "utf8"),
    context
  );
  return context;
}

test("deduit quelques themes des objets sans transmettre le corps des mails", () => {
  const context = loadService(async () => { throw new Error("appel inattendu"); });
  context.emails = [
    { subject: "Optirrig et irrigation du mais", bodyText: "SECRET ABSOLU" },
    { subject: "Re: irrigation et secheresse" },
  ];
  const topics = vm.runInContext("extractNewsTopics(emails, ['agronomie'])", context);
  assert.equal(topics[0], "agronomie");
  assert.ok(Array.from(topics).includes("irrigation"));
  assert.doesNotMatch(JSON.stringify(topics), /SECRET/);
});

test("compose un bulletin meteo et actualites avec les API publiques", async () => {
  const calls = [];
  const context = loadService(async (url) => {
    calls.push(String(url));
    if (String(url).includes("geocoding-api")) {
      return { ok: true, json: async () => ({ results: [{ name: "Bordeaux", country: "France", latitude: 44.84, longitude: -0.58 }] }) };
    }
    if (String(url).includes("open-meteo.com/v1/forecast")) {
      return { ok: true, json: async () => ({ daily: { time: ["2026-08-21"], weather_code: [61], temperature_2m_min: [15], temperature_2m_max: [24], precipitation_probability_max: [70], wind_speed_10m_max: [20] } }) };
    }
    return { ok: true, json: async () => ({ articles: [{ title: "Eau et agriculture", url: "https://news.example/article", domain: "news.example", seendate: "20260821" }] }) };
  });
  context.settings = { externalBriefEnabled: true, weatherLocation: "Bordeaux", externalNewsTopics: ["irrigation"] };
  const brief = await vm.runInContext("fetchExternalBrief(settings, [])", context);

  assert.equal(brief.weather.location, "Bordeaux, France");
  assert.equal(brief.weather.days[0].condition, "pluie");
  assert.equal(brief.news[0].title, "Eau et agriculture");
  assert.equal(calls.length, 3);
  assert.ok(calls.some((url) => /timespan=1d/.test(url)));
});

test("ne contacte aucun service lorsque le bulletin est desactive", async () => {
  let calls = 0;
  const context = loadService(async () => { calls++; });
  context.settings = { externalBriefEnabled: false };
  const brief = await vm.runInContext("fetchExternalBrief(settings, [])", context);
  assert.equal(brief, null);
  assert.equal(calls, 0);
});
