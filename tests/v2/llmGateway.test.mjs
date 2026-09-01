import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { createMemoryBackend, setStorageBackend } from "../../src/core/storage.js";
import { invalidateConfigCache, saveConfig, setSecret } from "../../src/core/settings.js";
import { chat, resetLearnedCapabilities, testProfile } from "../../src/llm/gateway.js";
import { setLogLevel } from "../../src/core/logger.js";

setLogLevel("silent");

const OLLAMA = {
  id: "p-ollama",
  label: "Ollama local",
  provider: "ollama",
  model: "llama3.1",
  baseUrl: "http://localhost:11434",
  enabled: true,
};

const OPENAI = {
  id: "p-openai",
  label: "OpenAI",
  provider: "openai",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
  enabled: true,
};

const ANTHROPIC = {
  id: "p-anthropic",
  label: "Claude",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  baseUrl: "https://api.anthropic.com",
  enabled: true,
};

/** Sequence de reponses HTTP simulees ; chaque appel consomme la suivante. */
function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: options?.body ? JSON.parse(options.body) : null });
    const next = responses.shift();
    if (!next) throw new Error(`Appel HTTP inattendu : ${url}`);
    if (typeof next === "function") return next(url, options);
    return {
      ok: next.status ? next.status < 400 : true,
      status: next.status || 200,
      text: async () => (typeof next.body === "string" ? next.body : JSON.stringify(next.body)),
    };
  };
  return calls;
}

function openAiReply(content, toolCalls) {
  return {
    body: {
      model: "gpt-4o-mini",
      choices: [{
        message: { content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
        finish_reason: toolCalls ? "tool_calls" : "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    },
  };
}

beforeEach(async () => {
  setStorageBackend(createMemoryBackend());
  invalidateConfigCache();
  resetLearnedCapabilities();
});

const SEARCH_TOOL = {
  name: "search_mail",
  description: "Cherche des mails",
  parameters: { type: "object", properties: { query: { type: "string" } } },
};

test("un profil local repond sans exiger de consentement distant", async () => {
  await saveConfig({ llm: { profiles: [OLLAMA] } });
  stubFetch([{ body: { model: "llama3.1", message: { content: "Bonjour" }, done_reason: "stop" } }]);

  const response = await chat({ messages: [{ role: "user", content: "salut" }] });

  assert.equal(response.text, "Bonjour");
  assert.equal(response.profileId, "p-ollama");
  assert.equal(response.finishReason, "stop");
});

test("un profil distant est refuse tant que le consentement n'est pas donne", async () => {
  await saveConfig({ llm: { profiles: [OPENAI] }, privacy: { allowRemoteProviders: false } });
  await setSecret(OPENAI.id, { apiKey: "sk-test" });
  stubFetch([]);

  await assert.rejects(
    chat({ messages: [{ role: "user", content: "salut" }] }),
    (error) => /Autorise les fournisseurs distants/.test(error.message)
  );
});

test("la cle API voyage en en-tete, jamais dans le corps", async () => {
  await saveConfig({ llm: { profiles: [OPENAI] }, privacy: { allowRemoteProviders: true } });
  await setSecret(OPENAI.id, { apiKey: "sk-secret" });
  const calls = stubFetch([openAiReply("ok")]);

  await chat({ messages: [{ role: "user", content: "salut" }] });

  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-secret");
  assert.ok(!JSON.stringify(calls[0].body).includes("sk-secret"));
});

test("le repli passe au profil suivant apres un echec reseau", async () => {
  await saveConfig({
    llm: { profiles: [OPENAI, OLLAMA] },
    privacy: { allowRemoteProviders: true },
  });
  await setSecret(OPENAI.id, { apiKey: "sk-test" });
  stubFetch([
    () => { throw new TypeError("network down"); },
    { body: { model: "llama3.1", message: { content: "Repli local" } } },
  ]);

  const response = await chat({ messages: [{ role: "user", content: "salut" }] });

  assert.equal(response.text, "Repli local");
  assert.equal(response.profileId, "p-ollama");
});

test("quand tous les profils echouent, l'erreur nomme chaque cause", async () => {
  await saveConfig({
    llm: { profiles: [OPENAI, OLLAMA] },
    privacy: { allowRemoteProviders: true },
  });
  await setSecret(OPENAI.id, { apiKey: "sk-test" });
  stubFetch([
    { status: 429, body: { error: { message: "rate limited" } } },
    { status: 500, body: { error: "boom" } },
  ]);

  await assert.rejects(chat({ messages: [{ role: "user", content: "x" }] }), (error) => {
    assert.match(error.message, /OpenAI/);
    assert.match(error.message, /Ollama local/);
    assert.equal(error.details.failures.length, 2);
    assert.equal(error.details.failures[0].code, "rate_limit");
    return true;
  });
});

test("les appels d'outils OpenAI sont normalises, arguments parses", async () => {
  await saveConfig({ llm: { profiles: [OPENAI] }, privacy: { allowRemoteProviders: true } });
  await setSecret(OPENAI.id, { apiKey: "sk-test" });
  stubFetch([openAiReply(null, [{
    id: "call_1",
    type: "function",
    function: { name: "search_mail", arguments: '{"query":"facture"}' },
  }])]);

  const response = await chat({ messages: [{ role: "user", content: "cherche" }], tools: [SEARCH_TOOL] });

  assert.equal(response.finishReason, "tool_calls");
  assert.deepEqual(response.toolCalls, [
    { id: "call_1", name: "search_mail", arguments: { query: "facture" } },
  ]);
});

test("les appels d'outils Anthropic donnent la meme forme normalisee", async () => {
  await saveConfig({ llm: { profiles: [ANTHROPIC] }, privacy: { allowRemoteProviders: true } });
  await setSecret(ANTHROPIC.id, { apiKey: "sk-ant" });
  const calls = stubFetch([{
    body: {
      model: "claude-sonnet-4-5",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Je cherche." },
        { type: "tool_use", id: "toolu_1", name: "search_mail", input: { query: "facture" } },
      ],
      usage: { input_tokens: 12, output_tokens: 3 },
    },
  }]);

  const response = await chat({
    messages: [
      { role: "system", content: "Tu es utile." },
      { role: "user", content: "cherche" },
    ],
    tools: [SEARCH_TOOL],
  });

  // Le prompt systeme est un champ de premier niveau chez Anthropic.
  assert.equal(calls[0].body.system, "Tu es utile.");
  assert.equal(calls[0].body.messages.length, 1);
  assert.equal(calls[0].body.tools[0].input_schema.type, "object");
  assert.deepEqual(response.toolCalls, [
    { id: "toolu_1", name: "search_mail", arguments: { query: "facture" } },
  ]);
});

test("un modele qui refuse les outils bascule en protocole emule", async () => {
  await saveConfig({ llm: { profiles: [OLLAMA] } });
  const calls = stubFetch([
    { status: 400, body: { error: "llama3.1 does not support tools" } },
    { body: { model: "llama3.1", message: { content: '{"action":"tool","tool":"search_mail","arguments":{"query":"facture"}}' } } },
  ]);

  const response = await chat({ messages: [{ role: "user", content: "cherche" }], tools: [SEARCH_TOOL] });

  assert.equal(response.toolMode, "emulated");
  assert.deepEqual(response.toolCalls[0].arguments, { query: "facture" });
  // La seconde requete ne contient plus d'outils natifs mais decrit le protocole.
  assert.equal(calls[1].body.tools, undefined);
  assert.match(calls[1].body.messages[0].content, /"action": "tool"/);
});

test("la bascule vers l'emulation est memorisee pour les appels suivants", async () => {
  await saveConfig({ llm: { profiles: [OLLAMA] } });
  const calls = stubFetch([
    { status: 400, body: { error: "model does not support tools" } },
    { body: { message: { content: '{"action":"answer","content":"rien"}' } } },
    { body: { message: { content: '{"action":"answer","content":"toujours rien"}' } } },
  ]);

  await chat({ messages: [{ role: "user", content: "a" }], tools: [SEARCH_TOOL] });
  const second = await chat({ messages: [{ role: "user", content: "b" }], tools: [SEARCH_TOOL] });

  assert.equal(second.text, "toujours rien");
  assert.equal(calls.length, 3, "le refus natif ne doit etre paye qu'une fois");
  assert.equal(calls[2].body.tools, undefined);
});

test("testProfile rapporte un echec sans lever", async () => {
  await saveConfig({ llm: { profiles: [OLLAMA] } });
  stubFetch([{ status: 404, body: { error: "model not found" } }]);

  const result = await testProfile(OLLAMA);

  assert.equal(result.ok, false);
  assert.equal(result.code, "configuration");
  assert.match(result.message, /ollama pull llama3\.1/);
});
