const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
    text: async () => typeof payload === "string" ? payload : JSON.stringify(payload),
  };
}

function loadClient(fetch, initialCredentials = {}) {
  const stored = { openAiCodexCredentials: initialCredentials };
  let openedUrl = "";
  const context = vm.createContext({
    AbortController,
    Date,
    Map,
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
    Uint8Array,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    clearTimeout,
    crypto: webcrypto,
    fetch,
    logger: { warn() {} },
    messenger: {
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults, ...stored }),
          set: async (values) => Object.assign(stored, values),
        },
      },
      tabs: {
        create: async ({ url }) => {
          openedUrl = url;
          return { id: 42 };
        },
        remove: async () => {},
      },
    },
    setTimeout,
  });
  vm.runInContext(readFileSync(join(__dirname, "..", "llm", "ollamaClient.js"), "utf8"), context);
  vm.runInContext(readFileSync(join(__dirname, "..", "llm", "openAiCodexClient.js"), "utf8"), context);
  return { context, stored, getOpenedUrl: () => openedUrl };
}

test("construit un OAuth PKCE Codex sans exposer le verifier", async () => {
  const { context, getOpenedUrl } = loadClient(async () => response(500, {}));

  await vm.runInContext('startOpenAiCodexAuthorization("profil-1")', context);
  const url = new URL(getOpenedUrl());

  assert.equal(url.origin, "https://auth.openai.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:1455/auth/callback");
  assert.ok(url.searchParams.get("code_challenge"));
  assert.ok(url.searchParams.get("state"));
  assert.equal(url.searchParams.has("code_verifier"), false);
});

test("echange le callback Codex et conserve le refresh token par profil", async () => {
  let tokenRequestBody = "";
  const { context, stored, getOpenedUrl } = loadClient(async (url, options) => {
    assert.equal(url, "https://auth.openai.com/oauth/token");
    tokenRequestBody = options.body;
    return response(200, {
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
    });
  });
  await vm.runInContext('startOpenAiCodexAuthorization("profil-1")', context);
  const state = new URL(getOpenedUrl()).searchParams.get("state");
  context.callbackUrl = `http://localhost:1455/auth/callback?code=one-time-code&state=${state}`;

  const result = await vm.runInContext(
    'completeOpenAiCodexAuthorization("profil-1", callbackUrl)',
    context
  );
  const tokenParams = new URLSearchParams(tokenRequestBody);

  assert.equal(result.status, "connected");
  assert.equal(tokenParams.get("code"), "one-time-code");
  assert.ok(tokenParams.get("code_verifier"));
  assert.equal(tokenParams.has("state"), false);
  assert.equal(stored.openAiCodexCredentials["profil-1"].refreshToken, "refresh-secret");
});

test("appelle le backend Responses Codex avec le compte ChatGPT", async () => {
  let request;
  const credentials = {
    "profil-1": {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: Date.now() + 60 * 60 * 1000,
      accountId: "account-123",
    },
  };
  const { context } = loadClient(async (url, options) => {
    request = { url, options };
    return response(200, [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Reponse "}',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Codex"}',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}',
      "data: [DONE]",
    ].join("\n\n"));
  }, credentials);
  context.options = {
    profile: { id: "profil-1", model: "gpt-5.3-codex" },
    messages: [
      { role: "system", content: "Consigne" },
      { role: "user", content: "Question" },
    ],
  };

  const answer = await vm.runInContext("callOpenAiCodexChat(options)", context);
  const body = JSON.parse(request.options.body);

  assert.equal(answer, "Reponse Codex");
  assert.equal(request.url, "https://chatgpt.com/backend-api/codex/responses");
  assert.equal(request.options.headers.Authorization, "Bearer access-secret");
  assert.equal(request.options.headers["ChatGPT-Account-Id"], "account-123");
  assert.equal(body.model, "gpt-5.3-codex");
  assert.equal(body.stream, true);
  assert.equal(body.reasoning.effort, "low");
  assert.equal(Object.hasOwn(body, "max_output_tokens"), false);
  assert.equal(request.options.headers.Accept, "text/event-stream");
  assert.equal(body.instructions, "Consigne");
  assert.equal(body.input[0].content[0].text, "Question");
});

test("remonte une erreur recue dans le flux Codex", async () => {
  const credentials = {
    "profil-1": {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
  };
  const { context } = loadClient(async () => response(200,
    'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"message":"modele indisponible"}}}\n\ndata: [DONE]'
  ), credentials);
  context.options = {
    profile: { id: "profil-1", model: "gpt-5.6-terra" },
    messages: [{ role: "user", content: "Test" }],
  };

  await assert.rejects(
    vm.runInContext("callOpenAiCodexChat(options)", context),
    /modele indisponible/
  );
});
