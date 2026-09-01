import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { createMemoryBackend, setStorageBackend } from "../../src/core/storage.js";
import { invalidateConfigCache, saveConfig } from "../../src/core/settings.js";
import { resetLearnedCapabilities } from "../../src/llm/gateway.js";
import { setLogLevel } from "../../src/core/logger.js";
import { coerceArguments, createToolset, defineTool, serializeToolResult } from "../../src/agent/toolRegistry.js";
import { runAgent } from "../../src/agent/runner.js";

setLogLevel("silent");

const OLLAMA = {
  id: "p-ollama",
  label: "Ollama local",
  provider: "ollama",
  model: "qwen3",
  baseUrl: "http://localhost:11434",
  enabled: true,
};

function stubOllama(turns) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const next = turns.shift();
    if (!next) throw new Error("Tour LLM inattendu");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ model: "qwen3", message: next }),
    };
  };
  return calls;
}

const echoTool = defineTool({
  name: "echo",
  description: "Renvoie ce qu'on lui donne",
  parameters: {
    type: "object",
    properties: { value: { type: "string" }, times: { type: "integer", minimum: 1, maximum: 3 } },
    required: ["value"],
  },
  handler: async (args) => ({ echo: args.value.repeat(args.times || 1) }),
});

const brokenTool = defineTool({
  name: "broken",
  description: "Echoue toujours",
  parameters: { type: "object", properties: {} },
  handler: async () => {
    throw new Error("disque plein");
  },
});

beforeEach(async () => {
  setStorageBackend(createMemoryBackend());
  invalidateConfigCache();
  resetLearnedCapabilities();
  await saveConfig({ llm: { profiles: [OLLAMA] } });
});

test("les arguments sont contraints au schema avant execution", () => {
  const schema = {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 10 },
      mode: { type: "string", enum: ["a", "b"] },
      flag: { type: "boolean" },
    },
  };
  assert.deepEqual(coerceArguments(schema, { limit: "42", flag: "true", mode: "b" }), {
    limit: 10,
    flag: true,
    mode: "b",
  });
  assert.throws(() => coerceArguments(schema, { mode: "z" }), /hors des choix autorises/);
  assert.throws(
    () => coerceArguments({ ...schema, required: ["mode"] }, {}),
    /Arguments manquants : mode/
  );
});

test("une erreur d'outil devient un resultat lisible, pas une exception", async () => {
  const toolset = createToolset([brokenTool]);
  const outcome = await toolset.run({ id: "1", name: "broken", arguments: {} });
  assert.deepEqual(outcome, { ok: false, error: "disque plein" });
  assert.equal(serializeToolResult(outcome), '{"erreur":"disque plein"}');
});

test("un outil inconnu est signale au modele sans interrompre la boucle", async () => {
  const toolset = createToolset([echoTool]);
  const outcome = await toolset.run({ id: "1", name: "inexistant", arguments: {} });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /Outil inconnu/);
});

test("la boucle enchaine outil puis reponse finale", async () => {
  const calls = stubOllama([
    { content: "", tool_calls: [{ function: { name: "echo", arguments: { value: "ha", times: 2 } } }] },
    { content: "Voila : haha" },
  ]);
  const steps = [];

  const outcome = await runAgent({
    system: "Tu es utile.",
    messages: [{ role: "user", content: "repete ha deux fois" }],
    toolset: createToolset([echoTool]),
    onStep: (step) => steps.push(step),
  });

  assert.equal(outcome.text, "Voila : haha");
  assert.equal(outcome.exhausted, false);
  assert.deepEqual(steps, [
    { tool: "echo", arguments: { value: "ha", times: 2 }, ok: true, result: { echo: "haha" } },
  ]);
  // Le second tour contient bien l'appel d'outil puis son resultat.
  const secondTurn = calls[1].messages;
  assert.equal(secondTurn.at(-2).tool_calls[0].function.name, "echo");
  assert.equal(secondTurn.at(-1).role, "tool");
  assert.equal(secondTurn.at(-1).content, '{"echo":"haha"}');
});

test("la limite de tours declenche une synthese au lieu d'un echec", async () => {
  const toolCall = {
    content: "",
    tool_calls: [{ function: { name: "echo", arguments: { value: "x" } } }],
  };
  stubOllama([toolCall, toolCall, { content: "Je n'ai pas pu conclure." }]);

  const outcome = await runAgent({
    messages: [{ role: "user", content: "boucle" }],
    toolset: createToolset([echoTool]),
    maxSteps: 2,
  });

  assert.equal(outcome.exhausted, true);
  assert.equal(outcome.text, "Je n'ai pas pu conclure.");
  assert.equal(outcome.steps.length, 2);
});

test("le protocole emule traverse la boucle comme un appel natif", async () => {
  stubOllama([
    { content: '{"action":"tool","tool":"echo","arguments":{"value":"ok"}}' },
    { content: '{"action":"answer","content":"Termine."}' },
  ]);
  // Aucun outil natif : le premier tour part deja en mode emule apres refus.
  globalThis.fetch = (function wrap(inner) {
    let first = true;
    return async (url, options) => {
      if (first) {
        first = false;
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: "qwen3 does not support tools" }),
        };
      }
      return inner(url, options);
    };
  })(globalThis.fetch);

  const outcome = await runAgent({
    messages: [{ role: "user", content: "vas-y" }],
    toolset: createToolset([echoTool]),
  });

  assert.equal(outcome.text, "Termine.");
  assert.deepEqual(outcome.steps[0].result, { echo: "ok" });
});
