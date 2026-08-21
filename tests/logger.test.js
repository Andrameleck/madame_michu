const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("conserve les messages ordinaires et masque les secrets imbriques", () => {
  const calls = [];
  const consoleMock = {
    debug: (...args) => calls.push(args),
    info: (...args) => calls.push(args),
    warn: (...args) => calls.push(args),
    error: (...args) => calls.push(args),
  };
  const context = vm.createContext({ console: consoleMock });
  vm.runInContext(readFileSync(join(__dirname, "..", "utils", "logger.js"), "utf8"), context);
  context.payload = {
    nested: { apiKey: "secret-value-123" },
    folders: ["INBOX", "Archives"],
    message: "visible",
  };
  vm.runInContext('logger.info("Demarrage", payload)', context);

  assert.equal(calls[0][1], "Demarrage");
  assert.equal(calls[0][2].message, "visible");
  assert.equal(calls[0][2].folders[0], "INBOX");
  assert.notEqual(calls[0][2].nested.apiKey, "secret-value-123");
});

test("masque les jetons OAuth Codex", () => {
  const calls = [];
  const context = vm.createContext({
    console: { debug() {}, info() {}, warn: (...args) => calls.push(args), error() {} },
  });
  vm.runInContext(readFileSync(join(__dirname, "..", "utils", "logger.js"), "utf8"), context);
  context.credentials = { accessToken: "access-secret-value", refresh_token: "refresh-secret-value" };

  vm.runInContext('logger.warn("oauth", credentials)', context);

  assert.notEqual(calls[0][2].accessToken, "access-secret-value");
  assert.notEqual(calls[0][2].refresh_token, "refresh-secret-value");
});
