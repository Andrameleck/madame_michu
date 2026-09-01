// Profil « abonnement ChatGPT ». Ce fournisseur est le seul a repondre en flux
// SSE et a ne pas toujours accepter les outils natifs : ses deux modes de sortie
// sont figes ici, ainsi que la degradation qui evite l'ecran vide.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { createMemoryBackend, setStorageBackend } from "../../src/core/storage.js";
import { invalidateConfigCache, saveConfig, setSecret } from "../../src/core/settings.js";
import { chat, resetLearnedCapabilities } from "../../src/llm/gateway.js";
import { parseResponseStream } from "../../src/llm/adapters/chatgpt.js";
import { setLogLevel } from "../../src/core/logger.js";

setLogLevel("silent");

const PROFILE = {
  id: "p-chatgpt",
  label: "GPT",
  provider: "chatgpt",
  model: "gpt-5.1-codex",
  baseUrl: "https://chatgpt.com/backend-api/codex",
  enabled: true,
};

const TOOL = {
  name: "search_mail",
  description: "Cherche des mails",
  parameters: { type: "object", properties: { keywords: { type: "string" } } },
};

function sse(events) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
}

function stubFetch(bodies) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    const next = bodies.shift();
    if (next === undefined) throw new Error("Appel HTTP inattendu");
    return { ok: true, status: 200, text: async () => next };
  };
  return calls;
}

beforeEach(async () => {
  setStorageBackend(createMemoryBackend());
  invalidateConfigCache();
  resetLearnedCapabilities();
  await saveConfig({ llm: { profiles: [PROFILE] }, privacy: { allowRemoteProviders: true } });
  await setSecret(PROFILE.id, {
    oauth: {
      accessToken: "at",
      refreshToken: "rt",
      // Jeton encore valable : aucun rafraichissement ne doit partir.
      expiresAt: Date.now() + 3600_000,
      accountId: "acc-1",
    },
  });
});

test("le flux SSE est reassemble a partir des fragments de texte", () => {
  const parsed = parseResponseStream(sse([
    { type: "response.output_text.delta", delta: "Bon" },
    { type: "response.output_text.delta", delta: "jour" },
    { type: "response.completed", response: { status: "completed", output: [] } },
  ]));
  assert.equal(parsed.text, "Bonjour");
  assert.equal(parsed.finishReason, "stop");
});

test("un appel d'outil est extrait de la reponse terminee", () => {
  const parsed = parseResponseStream(sse([
    { type: "response.completed", response: {
      status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        { type: "function_call", call_id: "fc_1", name: "search_mail", arguments: '{"keywords":"facture"}' },
      ],
    } },
  ]));
  assert.equal(parsed.finishReason, "tool_calls");
  assert.deepEqual(parsed.toolCalls, [
    { id: "fc_1", name: "search_mail", arguments: { keywords: "facture" } },
  ]);
});

test("un flux interrompu remonte la cause donnee par le service", () => {
  assert.throws(
    () => parseResponseStream(sse([{ type: "response.failed", response: { error: { message: "quota" } } }])),
    /quota/
  );
});

test("l'en-tete originator reste celui que le backend reconnait", async () => {
  const calls = stubFetch([sse([{ type: "response.output_text.delta", delta: "ok" }])]);
  await chat({ messages: [{ role: "user", content: "salut" }] });
  assert.equal(calls[0].options.headers.originator, "assistant-mail-ia");
  assert.equal(calls[0].options.headers.Authorization, "Bearer at");
  assert.equal(calls[0].options.headers["ChatGPT-Account-Id"], "acc-1");
});

test("le prompt systeme part en instructions, pas en message", async () => {
  const calls = stubFetch([sse([{ type: "response.output_text.delta", delta: "ok" }])]);
  await chat({
    messages: [
      { role: "system", content: "Tu es utile." },
      { role: "user", content: "salut" },
    ],
  });
  assert.equal(calls[0].body.instructions, "Tu es utile.");
  assert.equal(calls[0].body.input.length, 1);
  assert.equal(calls[0].body.input[0].content[0].type, "input_text");
});

test("un historique d'assistant est reinjecte en output_text", async () => {
  const calls = stubFetch([sse([{ type: "response.output_text.delta", delta: "ok" }])]);
  await chat({
    messages: [
      { role: "user", content: "salut" },
      { role: "assistant", content: "bonjour" },
      { role: "user", content: "et donc ?" },
    ],
  });
  // Etiqueter une sortie du modele en input_text fait echouer la requete.
  assert.equal(calls[0].body.input[1].content[0].type, "output_text");
});

test("une reponse vide malgre des outils bascule le profil en protocole emule", async () => {
  const calls = stubFetch([
    // Premier essai avec outils natifs : le backend ne renvoie rien d'exploitable.
    sse([{ type: "response.completed", response: { status: "completed", output: [] } }]),
    // Second essai, sans outils : le modele suit le protocole textuel.
    sse([{ type: "response.output_text.delta", delta: '{"action":"answer","content":"Rien de neuf."}' }]),
  ]);

  const response = await chat({
    messages: [{ role: "user", content: "quoi de neuf" }],
    tools: [TOOL],
  });

  assert.equal(response.text, "Rien de neuf.");
  assert.equal(response.toolMode, "emulated");
  assert.ok(calls[0].body.tools, "le premier essai propose bien les outils");
  assert.equal(calls[1].body.tools, undefined, "le second essai n'en propose plus");
  assert.match(calls[1].body.instructions, /"action": "tool"/);
});

test("sans outils, une reponse vide reste une erreur, mais diagnostique", async () => {
  stubFetch([sse([{ type: "response.reasoning_summary_part.added", part: {} }])]);

  await assert.rejects(chat({ messages: [{ role: "user", content: "salut" }] }), (error) => {
    // Le message doit dire ce qui est arrive, pas seulement que c'est vide.
    assert.match(error.message, /response\.reasoning_summary_part\.added/);
    return true;
  });
});
