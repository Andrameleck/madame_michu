const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadChatUi() {
  const createElement = (tagName = "div") => ({
    tagName,
    children: [],
    className: "",
    textContent: "",
    addEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    append(...children) { this.children.push(...children); },
  });
  const element = createElement();
  const context = vm.createContext({
    console: { warn() {} },
    document: {
      getElementById: () => element,
      createElement,
    },
    createMailSourceButton: () => createElement("button"),
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "ui", "sidebar", "chat.js"), "utf8"),
    context
  );
  return context;
}

test("replie les sources derriere un seul bouton ferme par defaut", () => {
  const context = loadChatUi();
  context.container = context.document.createElement("article");
  context.sources = [
    { subject: "Budget", author: "Alice", date: "2026-08-21T08:00:00Z" },
    { subject: "Reunion", author: "Marc", date: "2026-08-21T09:00:00Z" },
  ];

  vm.runInContext("appendSources(container, sources)", context);

  const details = context.container.children[0];
  assert.equal(details.tagName, "details");
  assert.equal(details.open, undefined);
  assert.equal(details.children[0].tagName, "summary");
  assert.equal(details.children[0].textContent, "Sources (2)");
  assert.equal(details.children[1].tagName, "ul");
});

test("separe les puces Markdown qu'un modele a collees dans un pave", () => {
  const context = loadChatUi();
  context.answer = "Voila les nouvelles : - **Informatique** : maintenance. - **Phishing** : faux mails.";

  const normalized = vm.runInContext("normalizeChatMarkdown(answer)", context);

  assert.equal(
    normalized,
    "Voila les nouvelles :\n- **Informatique** : maintenance.\n- **Phishing** : faux mails."
  );
});

test("Madame Michu termine sa journee sur les erreurs de quota ou d'authentification", () => {
  const context = loadChatUi();
  context.quotaError = new Error("HTTP 429: quota exceeded");
  context.authError = new Error("Token expired: authentication failed");

  assert.equal(
    vm.runInContext("chatFailureReply(quotaError)", context),
    "Désolée, j'ai fini ma journée."
  );
  assert.equal(
    vm.runInContext("chatFailureReply(authError)", context),
    "Désolée, j'ai fini ma journée."
  );
});

test("Madame Michu se met en pause sur les pannes de connexion", () => {
  const context = loadChatUi();
  context.networkError = new Error("NetworkError: connexion interrompue");

  assert.equal(
    vm.runInContext("chatFailureReply(networkError)", context),
    "Désolée, je suis en pause."
  );
});
