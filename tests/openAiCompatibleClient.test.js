const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function jsonResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  };
}

function loadClient(fetch) {
  const context = vm.createContext({ AbortController, clearTimeout, fetch, setTimeout, URL });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "utils", "providerSecurity.js"), "utf8"),
    context
  );
  vm.runInContext(
    readFileSync(join(__dirname, "..", "llm", "httpClient.js"), "utf8"),
    context
  );
  vm.runInContext(
    readFileSync(join(__dirname, "..", "llm", "ollamaClient.js"), "utf8"),
    context
  );
  vm.runInContext(
    readFileSync(join(__dirname, "..", "llm", "openAiCompatibleClient.js"), "utf8"),
    context
  );
  vm.runInContext(
    readFileSync(join(__dirname, "..", "llm", "anthropicClient.js"), "utf8"),
    context
  );
  vm.runInContext(
    readFileSync(join(__dirname, "..", "llm", "responseParser.js"), "utf8"),
    context
  );
  vm.runInContext(
    readFileSync(join(__dirname, "..", "llm", "providerClient.js"), "utf8"),
    context
  );
  return context;
}

test("appelle Chat Completions avec le modele et le bearer token", async () => {
  let request;
  const context = loadClient(async (url, options) => {
    request = { url, options };
    return jsonResponse(200, { choices: [{ message: { content: "Reponse" } }] });
  });
  context.options = {
    baseUrl: "https://chatbot.example/openai",
    apiKey: "secret",
    model: "chat-model",
    messages: [{ role: "user", content: "Bonjour" }],
  };
  const answer = await vm.runInContext("callOpenAiCompatibleChat(options)", context);

  assert.equal(answer, "Reponse");
  assert.equal(request.url, "https://chatbot.example/openai/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer secret");
  assert.equal(JSON.parse(request.options.body).model, "chat-model");
});

test("lit le premier vecteur de l'endpoint embeddings", async () => {
  const context = loadClient(async (url) => {
    assert.equal(url, "https://chatbot.example/openai/embeddings");
    return jsonResponse(200, { data: [{ embedding: [0.1, 0.2] }] });
  });
  context.options = {
    baseUrl: "https://chatbot.example/openai",
    apiKey: "secret",
    model: "embed-model",
    text: "Courriel",
  };
  const embedding = await vm.runInContext("callOpenAiCompatibleEmbedding(options)", context);
  assert.deepEqual(Array.from(embedding), [0.1, 0.2]);
});

test("diagnostique explicitement une erreur d'authentification", async () => {
  const context = loadClient(async () =>
    jsonResponse(401, { error: { message: "Invalid API key" } })
  );
  context.settings = {
    llmProvider: "openai-compatible",
    providerBaseUrl: "https://chatbot.example/openai",
    providerModel: "chat-model",
    apiKey: "bad-secret",
  };

  const result = await vm.runInContext("testProviderConnection(settings)", context);

  assert.equal(result.ok, false);
  assert.equal(result.category, "auth");
  assert.match(result.message, /Authentification refusee/);
});

test("recupere, dedoublonne et trie les modeles compatibles OpenAI", async () => {
  let request;
  const context = loadClient(async (url, options) => {
    request = { url, options };
    return jsonResponse(200, {
      data: [{ id: "zeta-chat" }, { id: "alpha-embed" }, { id: "zeta-chat" }],
    });
  });
  context.settings = {
    llmProvider: "openai-compatible",
    providerBaseUrl: "https://chatbot.example/openai",
    apiKey: "secret",
  };

  const result = await vm.runInContext("listProviderModels(settings)", context);

  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.models), ["alpha-embed", "zeta-chat"]);
  assert.equal(request.url, "https://chatbot.example/openai/models");
  assert.equal(request.options.headers.Authorization, "Bearer secret");
});

test("recupere les modeles Ollama via api tags", async () => {
  let requestedUrl;
  const context = loadClient(async (url) => {
    requestedUrl = url;
    return jsonResponse(200, { models: [{ model: "llama3.1:latest" }, { name: "nomic-embed-text" }] });
  });
  context.settings = {
    llmProvider: "ollama",
    providerBaseUrl: "http://localhost:11434",
  };

  const result = await vm.runInContext("listProviderModels(settings)", context);

  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.models), ["llama3.1:latest", "nomic-embed-text"]);
  assert.equal(requestedUrl, "http://localhost:11434/api/tags");
});

test("essaie automatiquement le chemin v1 si la route directe manque", async () => {
  const requestedUrls = [];
  const context = loadClient(async (url) => {
    requestedUrls.push(url);
    if (url === "https://api.example/models") {
      return jsonResponse(404, { error: { message: "Not found" } });
    }
    return jsonResponse(200, { data: [{ id: "chat-model" }] });
  });
  context.settings = {
    llmProvider: "openai-compatible",
    providerBaseUrl: "https://api.example",
    apiKey: "secret",
  };

  const result = await vm.runInContext("listProviderModels(settings)", context);

  assert.equal(result.ok, true);
  assert.deepEqual(requestedUrls, [
    "https://api.example/models",
    "https://api.example/v1/models",
  ]);
});

test("appelle Anthropic Messages avec ses en-tetes et son champ systeme", async () => {
  let request;
  const context = loadClient(async (url, options) => {
    request = { url, options };
    return jsonResponse(200, { content: [{ type: "text", text: "OK Anthropic" }] });
  });
  context.options = {
    baseUrl: "https://api.anthropic.com",
    apiKey: "anthropic-secret",
    model: "claude-test",
    messages: [
      { role: "system", content: "Consigne" },
      { role: "user", content: "Bonjour" },
    ],
  };

  const answer = await vm.runInContext("callAnthropicChat(options)", context);
  const body = JSON.parse(request.options.body);

  assert.equal(answer, "OK Anthropic");
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.options.headers["x-api-key"], "anthropic-secret");
  assert.equal(request.options.headers["anthropic-version"], "2023-06-01");
  assert.equal(body.system, "Consigne");
  assert.deepEqual(body.messages, [{ role: "user", content: "Bonjour" }]);
});

test("utilise le profil de secours lorsque le profil principal echoue", async () => {
  const requestedUrls = [];
  const context = loadClient(async (url) => {
    requestedUrls.push(url);
    if (url.startsWith("https://primary.example")) {
      return jsonResponse(503, { error: { message: "indisponible" } });
    }
    return jsonResponse(200, { choices: [{ message: { content: "Secours operationnel" } }] });
  });
  context.settings = {
    llmProfiles: [
      {
        name: "Principal",
        enabled: true,
        type: "openai-compatible",
        baseUrl: "https://primary.example/v1",
        model: "primary-model",
        apiKey: "one",
      },
      {
        name: "Secours",
        enabled: true,
        type: "openai-compatible",
        baseUrl: "https://backup.example/v1",
        model: "backup-model",
        apiKey: "two",
      },
    ],
  };
  context.messages = [{ role: "user", content: "Bonjour" }];

  const answer = await vm.runInContext("callProviderChat(settings, messages)", context);

  assert.equal(answer, "Secours operationnel");
  assert.deepEqual(requestedUrls, [
    "https://primary.example/v1/chat/completions",
    "https://backup.example/v1/chat/completions",
  ]);
});

test("retire les metadonnees internes des messages avant l'appel provider", async () => {
  let requestBody;
  const context = loadClient(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse(200, { choices: [{ message: { content: "Propre" } }] });
  });
  context.settings = {
    llmProfiles: [{
      name: "Compatible strict",
      enabled: true,
      type: "openai-compatible",
      baseUrl: "https://strict.example/v1",
      model: "strict-model",
    }],
  };
  context.messages = [{
    role: "user",
    content: "Quoi de neuf ?",
    scope: "gossip",
    internalFlag: true,
  }];

  await vm.runInContext("callProviderChat(settings, messages)", context);

  assert.deepEqual(requestBody.messages, [{ role: "user", content: "Quoi de neuf ?" }]);
});

test("bloque les donnees mail distantes tant que le consentement est refuse", async () => {
  let called = false;
  const context = loadClient(async () => {
    called = true;
    return jsonResponse(200, { choices: [{ message: { content: "Indesirable" } }] });
  });
  context.settings = {
    remoteDataConsentAccepted: false,
    llmProfiles: [{
      name: "Distant",
      enabled: true,
      type: "openai-compatible",
      baseUrl: "https://llm.example/v1",
      model: "chat-model",
    }],
  };
  context.messages = [{ role: "user", content: "Contenu de mail" }];

  await assert.rejects(
    vm.runInContext("callProviderChat(settings, messages)", context),
    /consentement dans les options/
  );
  assert.equal(called, false);
});

test("signale clairement l'absence de profil de secours", async () => {
  const context = loadClient(async () => {
    throw new TypeError("fetch failed");
  });
  context.settings = {
    llmProfiles: [{
      name: "Ollama local",
      enabled: true,
      type: "ollama",
      baseUrl: "http://localhost:11434",
      model: "llama3.1",
    }],
  };
  context.messages = [{ role: "user", content: "Bonjour" }];

  await assert.rejects(
    vm.runInContext("callProviderChat(settings, messages)", context),
    /Le seul profil LLM actif a echoue.*Aucun profil de secours actif/
  );
});

test("ignore les profils desactives pendant le repli", async () => {
  const requestedUrls = [];
  const context = loadClient(async (url) => {
    requestedUrls.push(url);
    return jsonResponse(200, { choices: [{ message: { content: "Actif" } }] });
  });
  context.settings = {
    llmProfiles: [
      { name: "Coupe", enabled: false, type: "openai-compatible", baseUrl: "https://off.example/v1", model: "off" },
      { name: "Actif", enabled: true, type: "openai-compatible", baseUrl: "https://on.example/v1", model: "on" },
    ],
  };
  context.messages = [{ role: "user", content: "Test" }];

  await vm.runInContext("callProviderChat(settings, messages)", context);

  assert.deepEqual(requestedUrls, ["https://on.example/v1/chat/completions"]);
});

test("essaie le profil prefere avant l'ordre visuel puis conserve les autres en secours", async () => {
  const requestedUrls = [];
  const context = loadClient(async (url) => {
    requestedUrls.push(url);
    if (url.startsWith("https://preferred.example")) {
      return jsonResponse(503, { error: { message: "indisponible" } });
    }
    return jsonResponse(200, { choices: [{ message: { content: "Secours" } }] });
  });
  context.settings = {
    preferredProviderId: "preferred",
    llmProfiles: [
      { id: "first", name: "Premier onglet", enabled: true, type: "openai-compatible", baseUrl: "https://first.example/v1", model: "first" },
      { id: "preferred", name: "Prefere", enabled: true, type: "openai-compatible", baseUrl: "https://preferred.example/v1", model: "preferred" },
    ],
  };
  context.messages = [{ role: "user", content: "Test" }];

  const answer = await vm.runInContext("callProviderChat(settings, messages)", context);

  assert.equal(answer, "Secours");
  assert.deepEqual(requestedUrls, [
    "https://preferred.example/v1/chat/completions",
    "https://first.example/v1/chat/completions",
  ]);
});

test("essaie le profil suivant si le resume du premier est inexploitable", async () => {
  let requestCount = 0;
  const validSummary = JSON.stringify({
    summary: { overview: "Synthese", urgent: [], important: [], info: [], other: [] },
    events: [],
  });
  const context = loadClient(async () => {
    requestCount++;
    return jsonResponse(200, {
      choices: [{ message: { content: requestCount === 1 ? "pas du JSON" : validSummary } }],
    });
  });
  context.settings = {
    llmProfiles: [
      { name: "Bavard", enabled: true, type: "openai-compatible", baseUrl: "https://one.example/v1", model: "one" },
      { name: "Valide", enabled: true, type: "openai-compatible", baseUrl: "https://two.example/v1", model: "two" },
    ],
  };

  const result = await vm.runInContext("callProviderSummary(settings, 'systeme', 'mails')", context);

  assert.equal(result, validSummary);
  assert.equal(requestCount, 2);
});

test("ne resonde plus la route v1 une fois qu'elle a repondu", async () => {
  const urls = [];
  const context = loadClient(async (url) => {
    urls.push(url);
    if (url === "https://api.example.com/chat/completions") return jsonResponse(404, {});
    return jsonResponse(200, { choices: [{ message: { content: "Reponse" } }] });
  });
  context.options = {
    baseUrl: "https://api.example.com",
    apiKey: "secret",
    model: "chat-model",
    messages: [{ role: "user", content: "Bonjour" }],
  };

  await vm.runInContext("callOpenAiCompatibleChat(options)", context);
  await vm.runInContext("callOpenAiCompatibleChat(options)", context);

  assert.deepEqual(urls, [
    "https://api.example.com/chat/completions",
    "https://api.example.com/v1/chat/completions",
    "https://api.example.com/v1/chat/completions",
  ]);
});

test("reprend le sondage complet si la route memorisee disparait", async () => {
  const urls = [];
  let v1Disponible = true;
  const context = loadClient(async (url) => {
    urls.push(url);
    if (url === "https://api.example.com/v1/chat/completions" && v1Disponible) {
      return jsonResponse(200, { choices: [{ message: { content: "Reponse" } }] });
    }
    if (url === "https://api.example.com/chat/completions" && !v1Disponible) {
      return jsonResponse(200, { choices: [{ message: { content: "Reponse" } }] });
    }
    return jsonResponse(404, {});
  });
  context.options = {
    baseUrl: "https://api.example.com",
    apiKey: "secret",
    model: "chat-model",
    messages: [{ role: "user", content: "Bonjour" }],
  };

  await vm.runInContext("callOpenAiCompatibleChat(options)", context);
  v1Disponible = false;
  const answer = await vm.runInContext("callOpenAiCompatibleChat(options)", context);

  assert.equal(answer, "Reponse");
  assert.deepEqual(urls.slice(2), [
    "https://api.example.com/v1/chat/completions",
    "https://api.example.com/chat/completions",
  ]);
});
