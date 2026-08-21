// Acces aux modeles Codex inclus dans un abonnement ChatGPT via OAuth PKCE.
// Ce provider utilise le backend Codex/Responses, pas l'API OpenAI a cle.

const OPENAI_CODEX_AUTH_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_API_URL = "https://chatgpt.com/backend-api/codex/responses";
const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_CODEX_CREDENTIALS_KEY = "openAiCodexCredentials";
const OPENAI_CODEX_MODELS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5-codex",
  "gpt-5-codex-mini",
];
const codexAuthFlows = new Map();
const codexRefreshPromises = new Map();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBase64Url(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function parseJwtClaims(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

function extractCodexIdentity(tokens) {
  const claims = parseJwtClaims(tokens.id_token || tokens.access_token || "");
  const nested = claims["https://api.openai.com/auth"] || {};
  return {
    accountId: claims.chatgpt_account_id || nested.chatgpt_account_id || claims.organizations?.[0]?.id || "",
    email: claims.email || "",
  };
}

async function getAllCodexCredentials() {
  const stored = await messenger.storage.local.get({ [OPENAI_CODEX_CREDENTIALS_KEY]: {} });
  return stored[OPENAI_CODEX_CREDENTIALS_KEY] || {};
}

async function getOpenAiCodexCredentials(profileId) {
  const credentials = await getAllCodexCredentials();
  return credentials[profileId] || null;
}

async function saveOpenAiCodexCredentials(profileId, credentials) {
  const allCredentials = await getAllCodexCredentials();
  await messenger.storage.local.set({
    [OPENAI_CODEX_CREDENTIALS_KEY]: { ...allCredentials, [profileId]: credentials },
  });
}

async function deleteOpenAiCodexCredentials(profileId) {
  const allCredentials = await getAllCodexCredentials();
  delete allCredentials[profileId];
  await messenger.storage.local.set({ [OPENAI_CODEX_CREDENTIALS_KEY]: allCredentials });
  codexAuthFlows.delete(profileId);
  codexRefreshPromises.delete(profileId);
}

async function requestCodexToken(parameters) {
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters).toString(),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new LlmCallError(`Authentification Codex refusee (${response.status}) : ${detail}`, {
      code: "auth",
    });
  }
  const data = await response.json().catch((error) => {
    throw new LlmCallError("Reponse OAuth Codex non-JSON.", {
      cause: error,
      code: "invalid_response",
    });
  });
  if (!data.access_token || !data.expires_in) {
    throw new LlmCallError("Reponse OAuth Codex incomplete.", { code: "invalid_response" });
  }
  return data;
}

async function exchangeOpenAiCodexCode(profileId, code, verifier) {
  const tokens = await requestCodexToken({
    grant_type: "authorization_code",
    client_id: OPENAI_CODEX_CLIENT_ID,
    code,
    redirect_uri: OPENAI_CODEX_REDIRECT_URI,
    code_verifier: verifier,
  });
  if (!tokens.refresh_token) {
    throw new LlmCallError("OpenAI n'a pas retourne de refresh token Codex.", {
      code: "invalid_response",
    });
  }
  const identity = extractCodexIdentity(tokens);
  const credentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    ...identity,
  };
  await saveOpenAiCodexCredentials(profileId, credentials);
  return credentials;
}

async function refreshOpenAiCodexCredentials(profileId, credentials) {
  const tokens = await requestCodexToken({
    grant_type: "refresh_token",
    client_id: OPENAI_CODEX_CLIENT_ID,
    refresh_token: credentials.refreshToken,
  });
  const identity = extractCodexIdentity(tokens);
  const refreshed = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || credentials.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    accountId: identity.accountId || credentials.accountId || "",
    email: identity.email || credentials.email || "",
  };
  await saveOpenAiCodexCredentials(profileId, refreshed);
  return refreshed;
}

async function getValidOpenAiCodexCredentials(profileId, forceRefresh = false) {
  const credentials = await getOpenAiCodexCredentials(profileId);
  if (!credentials) {
    throw new LlmCallError("Ce profil n'est pas connecte a ChatGPT.", { code: "auth" });
  }
  if (!forceRefresh && Date.now() < credentials.expiresAt - 5 * 60 * 1000) return credentials;
  try {
    if (!codexRefreshPromises.has(profileId)) {
      codexRefreshPromises.set(
        profileId,
        refreshOpenAiCodexCredentials(profileId, credentials).finally(() => {
          codexRefreshPromises.delete(profileId);
        })
      );
    }
    return await codexRefreshPromises.get(profileId);
  } catch (error) {
    if (error.code === "auth") await deleteOpenAiCodexCredentials(profileId);
    throw error;
  }
}

async function startOpenAiCodexAuthorization(profileId) {
  if (!profileId) throw new Error("Identifiant de profil Codex manquant.");
  const verifier = randomBase64Url(32);
  const challenge = await sha256Base64Url(verifier);
  const state = randomBase64Url(24);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CODEX_CLIENT_ID,
    redirect_uri: OPENAI_CODEX_REDIRECT_URI,
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "assistant-mail-ia",
  });
  const flow = { profileId, verifier, state, status: "pending", tabId: null, error: "" };
  codexAuthFlows.set(profileId, flow);
  const tab = await messenger.tabs.create({ url: `${OPENAI_CODEX_AUTH_URL}?${params}` });
  flow.tabId = tab.id;
  return { status: "pending", authUrl: `${OPENAI_CODEX_AUTH_URL}?${params}` };
}

async function completeOpenAiCodexAuthorization(profileId, callbackUrl) {
  const flow = codexAuthFlows.get(profileId);
  if (!flow) throw new Error("Aucune connexion ChatGPT n'est en attente pour ce profil.");
  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error("L'URL de retour OAuth est invalide.");
  }
  if (`${url.origin}${url.pathname}` !== OPENAI_CODEX_REDIRECT_URI) {
    throw new Error("Cette URL ne correspond pas au callback Codex attendu.");
  }
  if (url.searchParams.get("state") !== flow.state) {
    throw new Error("Etat OAuth invalide : connexion refusee pour eviter une attaque CSRF.");
  }
  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (oauthError) throw new Error(`Connexion OpenAI refusee : ${oauthError}`);
  if (!code) throw new Error("Le callback OpenAI ne contient aucun code.");
  try {
    const credentials = await exchangeOpenAiCodexCode(profileId, code, flow.verifier);
    flow.status = "connected";
    return { status: "connected", email: credentials.email || "" };
  } catch (error) {
    flow.status = "error";
    flow.error = error.message || "Connexion ChatGPT impossible.";
    throw error;
  }
}

async function getOpenAiCodexAuthStatus(profileId) {
  const credentials = await getOpenAiCodexCredentials(profileId);
  if (credentials) {
    return { status: "connected", email: credentials.email || "", accountId: credentials.accountId || "" };
  }
  const flow = codexAuthFlows.get(profileId);
  return flow ? { status: flow.status, error: flow.error || "" } : { status: "disconnected" };
}

async function handleOpenAiCodexTabUpdate(tabId, changeInfo) {
  if (!changeInfo.url?.startsWith(OPENAI_CODEX_REDIRECT_URI)) return;
  const flow = [...codexAuthFlows.values()].find((candidate) => candidate.tabId === tabId);
  if (!flow) return;
  try {
    await completeOpenAiCodexAuthorization(flow.profileId, changeInfo.url);
    await messenger.tabs.remove(tabId).catch(() => {});
  } catch (error) {
    logger.warn("Callback OAuth Codex refuse", error);
  }
}

function codexInputFromMessages(messages) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => String(message.content || ""))
    .join("\n\n");
  const input = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: [{ type: "input_text", text: String(message.content || "") }],
    }));
  return { instructions, input };
}

function extractCodexResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  if (!Array.isArray(data?.output)) return "";
  return data.output
    .filter((item) => item?.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((content) => content?.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("\n")
    .trim();
}

function extractCodexStreamText(rawBody) {
  const raw = String(rawBody || "").trim();
  if (!raw) return "";

  // Garde une compatibilite avec une eventuelle reponse JSON non streamee.
  if (raw.startsWith("{")) {
    try {
      return extractCodexResponseText(JSON.parse(raw));
    } catch {
      return "";
    }
  }

  let output = "";
  let completedResponse = null;
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const payload = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!payload || payload === "[DONE]") continue;

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      output += event.delta;
    } else if (event.type === "response.output_text.done" && !output && typeof event.text === "string") {
      output = event.text;
    } else if (event.type === "response.completed") {
      completedResponse = event.response;
    } else if (event.type === "response.failed" || event.type === "error") {
      const detail = event.response?.error?.message || event.error?.message || event.message;
      throw new LlmCallError(`Flux Codex interrompu${detail ? ` : ${detail}` : "."}`, {
        code: "provider",
      });
    }
  }
  return output.trim() || extractCodexResponseText(completedResponse);
}

async function postOpenAiCodex(
  profile,
  messages,
  credentials,
  { timeoutMs, reasoningEffort }
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { instructions, input } = codexInputFromMessages(messages);
  try {
    return await fetch(OPENAI_CODEX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${credentials.accessToken}`,
        originator: "assistant-mail-ia",
        session_id: crypto.randomUUID(),
        ...(credentials.accountId ? { "ChatGPT-Account-Id": credentials.accountId } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: profile.model,
        input,
        ...(instructions ? { instructions } : {}),
        reasoning: { effort: reasoningEffort },
        stream: true,
        store: false,
      }),
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new LlmCallError(`Timeout Codex apres ${Math.round(timeoutMs / 1000)}s.`, {
        code: "timeout",
      });
    }
    throw new LlmCallError("Impossible de contacter le backend Codex de ChatGPT.", {
      cause: error,
      code: "network",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAiCodexChat({
  profile,
  messages,
  timeoutMs = 120_000,
  reasoningEffort = "low",
}) {
  let credentials = await getValidOpenAiCodexCredentials(profile.id);
  const requestOptions = { timeoutMs, reasoningEffort };
  let response = await postOpenAiCodex(profile, messages, credentials, requestOptions);
  if (response.status === 401) {
    credentials = await getValidOpenAiCodexCredentials(profile.id, true);
    response = await postOpenAiCodex(profile, messages, credentials, requestOptions);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    const code = response.status === 401 || response.status === 403
      ? "auth"
      : response.status === 429 ? "rate_limit" : "provider";
    throw new LlmCallError(`Codex a repondu ${response.status} : ${detail}`, { code });
  }
  const rawBody = await response.text().catch((error) => {
    throw new LlmCallError("Flux Codex illisible.", {
      cause: error,
      code: "invalid_response",
    });
  });
  const text = extractCodexStreamText(rawBody);
  if (!text) throw new LlmCallError("Reponse Codex sans texte exploitable.");
  return text;
}

function listOpenAiCodexModels() {
  return [...OPENAI_CODEX_MODELS];
}
