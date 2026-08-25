const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "..", "ui", "options", "options.js"), "utf8");

function functionPrefix(name, nextDeclaration, permissionFunction = "requestProviderPermissions") {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`\n${nextDeclaration}`, start);
  assert.notEqual(start, -1, `fonction ${name} absente`);
  assert.notEqual(end, -1, `borne suivante ${nextDeclaration} absente`);
  const body = source.slice(start, end);
  const permissionCall = body.indexOf(`await ${permissionFunction}(`);
  assert.notEqual(permissionCall, -1, `demande de permission absente de ${name}`);
  return body.slice(0, permissionCall)
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

test("demande les permissions avant tout await pendant l'enregistrement", () => {
  assert.doesNotMatch(
    functionPrefix("save", "function splitList(", "requestConfigurationPermissions"),
    /\bawait\b/
  );
});

test("demande les permissions avant tout await pendant la connexion ChatGPT", () => {
  assert.doesNotMatch(
    functionPrefix("connectOpenAiCodex", "async function completeOpenAiCodexManually("),
    /\bawait\b/
  );
});

test("permet d'enregistrer le retrait du consentement distant", () => {
  const start = source.indexOf("async function save(");
  const end = source.indexOf("\nfunction splitList(", start);
  const body = source.slice(start, end);

  assert.match(body, /fields\.remoteDataConsent\.checked\s*\?[^:]+:\s*\[\]/s);
  assert.match(body, /remoteDataConsentAccepted:\s*fields\.remoteDataConsent\.checked/);
});

test("regroupe les permissions des providers et du flux RSS choisi", () => {
  const start = source.indexOf("async function save(");
  const end = source.indexOf("\nfunction splitList(", start);
  const body = source.slice(start, end);
  assert.equal((body.match(/await requestConfigurationPermissions\(/g) || []).length, 1);
  assert.doesNotMatch(body, /requestWeatherPermissions/);
  assert.doesNotMatch(source, /geocoding-api\.open-meteo\.com\/\*/);
  assert.doesNotMatch(source, /fields\.weatherEnabled|fields\.weatherLocation/);
  assert.match(source, /newsFeedUrl = normalizeNewsFeedUrl/);
  assert.match(source, /\.origin}\/?\*/);
  assert.match(source, /const newsOrigins = newsOrigin \? \[newsOrigin\] : \[\]/);
});
