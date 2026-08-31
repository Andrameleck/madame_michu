const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadFiles(context, files) {
  for (const file of files) {
    vm.runInContext(readFileSync(join(__dirname, "..", file), "utf8"), context, { filename: file });
  }
}

function baseContext(messengerOverrides = {}) {
  const stored = {};
  const messenger = {
    storage: {
      local: {
        // Un delai artificiel force un veritable entrelacement entre deux
        // appels concurrents, comme au chargement de la sidebar : sans lui,
        // deux "get" consecutifs dans le meme tick pourraient ne jamais se
        // chevaucher et masquer la regression testee ci-dessous.
        get: async (defaults) => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return { ...defaults, ...stored };
        },
        set: async (values) => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          Object.assign(stored, values);
        },
      },
    },
    ...messengerOverrides,
  };
  const context = vm.createContext({ console, Date, Math, Object, Array, Map, Set, String, Promise, setTimeout, clearTimeout, messenger });
  return { context, stored };
}

test("des propositions d'action concurrentes ne s'effacent pas les unes les autres", async () => {
  const { context } = baseContext();
  loadFiles(context, ["utils/storage.js", "background/actionEngine.js"]);
  vm.runInContext(`
    registerActionTool({ name: "test.a", description: "A", risk: ACTION_RISK.READ, execute: async () => ({ ok: "a" }) });
    registerActionTool({ name: "test.b", description: "B", risk: ACTION_RISK.READ, execute: async () => ({ ok: "b" }) });
    registerActionTool({ name: "test.c", description: "C", risk: ACTION_RISK.READ, execute: async () => ({ ok: "c" }) });
  `, context);
  const [a, b, c] = await vm.runInContext(`
    Promise.all([
      proposeAction("test.a", {}, { origin: "test" }),
      proposeAction("test.b", {}, { origin: "test" }),
      proposeAction("test.c", {}, { origin: "test" }),
    ])
  `, context);
  assert.equal(a.status, "succeeded");
  assert.equal(b.status, "succeeded");
  assert.equal(c.status, "succeeded");
  const actions = await vm.runInContext("getActions()", context);
  assert.equal(actions.length, 3);
});

test("une ecriture reste en attente de confirmation puis s'execute apres validation", async () => {
  const { context } = baseContext();
  loadFiles(context, ["utils/storage.js", "background/actionEngine.js"]);
  let executions = 0;
  context.bumpExecutions = () => { executions += 1; return { executions }; };
  vm.runInContext(`
    registerActionTool({ name: "test.write", description: "Ecriture", risk: ACTION_RISK.WRITE, execute: async () => bumpExecutions() });
  `, context);
  const proposed = await vm.runInContext('proposeAction("test.write", {}, { origin: "test" })', context);
  assert.equal(proposed.status, "proposed");
  assert.equal(executions, 0);
  const completed = await vm.runInContext(`approveAction("${proposed.id}")`, context);
  assert.equal(completed.status, "succeeded");
  assert.equal(executions, 1);
});

test("un refus est conserve dans le journal sans jamais executer l'outil", async () => {
  const { context } = baseContext();
  loadFiles(context, ["utils/storage.js", "background/actionEngine.js"]);
  vm.runInContext(`
    registerActionTool({ name: "test.write", description: "Ecriture", risk: ACTION_RISK.WRITE, execute: async () => { throw new Error("ne doit jamais s'executer"); } });
  `, context);
  const proposed = await vm.runInContext('proposeAction("test.write")', context);
  const rejected = await vm.runInContext(`rejectAction("${proposed.id}")`, context);
  assert.equal(rejected.status, "rejected");
});

test("mail.create_draft enregistre un brouillon via compose.beginNew/saveMessage", async () => {
  const composeCalls = [];
  const { context } = baseContext({
    compose: {
      beginNew: async (_window, details) => { composeCalls.push(details); return { id: 42 }; },
      saveMessage: async (_tabId, { mode }) => ({
        mode,
        messages: [{ id: 7, headerMessageId: "abc@local", subject: composeCalls[0].subject, folder: { path: "/Drafts" } }],
      }),
    },
    tabs: { remove: async () => {} },
  });
  loadFiles(context, ["utils/storage.js", "background/actionEngine.js"]);
  const result = await vm.runInContext(`
    proposeAction("mail.create_draft", { to: ["a@b.test"], subject: "Bonjour", body: "Un message" }, { origin: "test", preapproved: true })
  `, context);
  assert.equal(result.status, "succeeded");
  assert.equal(result.result.headerMessageId, "abc@local");
  assert.equal(composeCalls[0].to[0], "a@b.test");
});
