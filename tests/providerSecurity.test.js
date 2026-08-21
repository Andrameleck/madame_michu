const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = vm.createContext({ URL, Set, String, Error });
vm.runInContext(
  readFileSync(join(__dirname, "..", "utils", "providerSecurity.js"), "utf8"),
  context
);

test("autorise HTTPS et nettoie l'URL du provider", () => {
  context.value = "https://llm.example/v1/?debug=true#fragment";
  assert.equal(
    vm.runInContext("normalizeProviderUrl(value)", context),
    "https://llm.example/v1"
  );
});

test("autorise HTTP uniquement pour les providers locaux", () => {
  for (const url of [
    "http://localhost:11434",
    "http://127.0.0.1:11434",
    "http://[::1]:11434",
  ]) {
    context.value = url;
    assert.doesNotThrow(() => vm.runInContext("normalizeProviderUrl(value)", context));
    assert.equal(vm.runInContext("isLocalProviderUrl(value)", context), true);
  }

  context.value = "http://llm.example/v1";
  assert.throws(
    () => vm.runInContext("normalizeProviderUrl(value)", context),
    /doit utiliser HTTPS/
  );
});

test("refuse les identifiants integres a une URL", () => {
  context.value = "https://secret:visible@llm.example/v1";
  assert.throws(
    () => vm.runInContext("normalizeProviderUrl(value)", context),
    /sans identifiants integres/
  );
});
