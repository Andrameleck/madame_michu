import assert from "node:assert/strict";
import test from "node:test";
import { createLogger, redact, setLogSink, setLogLevel } from "../../src/core/logger.js";

test("redaction: les secrets ne sortent jamais, quel que soit le niveau d'imbrication", () => {
  const redacted = redact({
    profile: { label: "Ollama", apiKey: "sk-secret", nested: { refreshToken: "rt-secret" } },
  });
  assert.equal(redacted.profile.apiKey, "[secret]");
  assert.equal(redacted.profile.nested.refreshToken, "[secret]");
  assert.equal(redacted.profile.label, "Ollama");
});

test("redaction: le contenu utilisateur est reduit a sa taille", () => {
  assert.equal(redact({ body: "objet confidentiel du mail" }).body, "[26 caracteres]");
  assert.equal(redact({ subject: "RE: paie" }).subject, "[8 caracteres]");
});

test("le journal transmet scope et contexte redige au sink", () => {
  const lines = [];
  setLogSink({ warn: (...args) => lines.push(args) });
  setLogLevel("debug");
  createLogger("llm").warn("echec", { apiKey: "sk-1", model: "llama3" });
  setLogSink(null);
  assert.equal(lines[0][0], "[michu:llm] echec");
  assert.deepEqual(lines[0][1], { apiKey: "[secret]", model: "llama3" });
});
