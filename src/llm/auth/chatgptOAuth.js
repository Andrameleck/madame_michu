// Flux OAuth PKCE de l'abonnement ChatGPT (Plus/Pro/Team). Ce module ne connait
// que l'authentification : il ne sait rien des messages ni des outils. Il
// n'ecrit jamais les jetons ailleurs que dans le coffre injecte par la gateway.

import { AppError, ProviderError } from "../../core/errors.js";

export const CHATGPT_OAUTH = Object.freeze({
  authUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  redirectUri: "http://localhost:1455/auth/callback",
  scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
  originator: "madame-michu",
});

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Une connexion en cours par profil, et une seule promesse de rafraichissement :
// deux appels LLM simultanes ne doivent pas consommer deux fois le refresh token.
const pendingFlows = new Map();
const pendingRefreshes = new Map();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(size = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function jwtClaims(token) {
  try {
    const payload = String(token).split(".")[1];
    if (!payload) return {};
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

function identityFrom(tokens) {
  const claims = jwtClaims(tokens.id_token || tokens.access_token || "");
  const nested = claims["https://api.openai.com/auth"] || {};
  return {
    accountId:
      claims.chatgpt_account_id || nested.chatgpt_account_id || claims.organizations?.[0]?.id || "",
    email: claims.email || "",
  };
}

async function requestTokens(parameters) {
  const response = await fetch(CHATGPT_OAUTH.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters).toString(),
  }).catch((error) => {
    throw new ProviderError("Impossible de joindre le service d'authentification OpenAI.", {
      code: "network",
      cause: error,
    });
  });
  if (!response.ok) {
    throw new ProviderError(`OpenAI a refuse l'authentification (statut ${response.status}).`, {
      code: "auth",
    });
  }
  const tokens = await response.json().catch(() => null);
  if (!tokens?.access_token || !tokens.expires_in) {
    throw new ProviderError("Reponse d'authentification OpenAI incomplete.", {
      code: "invalid_response",
    });
  }
  return tokens;
}

/**
 * Ouvre la page de connexion OpenAI et memorise l'etat PKCE du profil.
 * @param {string} profileId
 * @param {{ openTab: (url: string) => Promise<{ id?: number }> }} host
 */
export async function startAuthorization(profileId, host) {
  const verifier = randomToken(32);
  const state = randomToken(24);
  const parameters = new URLSearchParams({
    response_type: "code",
    client_id: CHATGPT_OAUTH.clientId,
    redirect_uri: CHATGPT_OAUTH.redirectUri,
    scope: CHATGPT_OAUTH.scope,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: CHATGPT_OAUTH.originator,
  });
  const authUrl = `${CHATGPT_OAUTH.authUrl}?${parameters}`;
  const flow = { profileId, verifier, state, status: "pending", tabId: null, error: "" };
  pendingFlows.set(profileId, flow);
  const tab = await host.openTab(authUrl);
  flow.tabId = tab?.id ?? null;
  return { status: "pending", authUrl };
}

/** Valide le callback OAuth et echange le code contre des jetons. */
export async function completeAuthorization(profileId, callbackUrl, saveCredentials) {
  const flow = pendingFlows.get(profileId);
  if (!flow) {
    throw new AppError("Aucune connexion ChatGPT n'est en attente pour ce profil.", {
      code: "configuration",
    });
  }
  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new AppError("L'URL de retour OAuth est invalide.", { code: "configuration" });
  }
  if (`${url.origin}${url.pathname}` !== CHATGPT_OAUTH.redirectUri) {
    throw new AppError("Cette URL ne correspond pas au callback attendu.", { code: "configuration" });
  }
  // Verifier l'etat avant tout echange : c'est la seule protection contre un
  // code injecte par un tiers.
  if (url.searchParams.get("state") !== flow.state) {
    throw new AppError("Etat OAuth invalide : connexion refusee.", { code: "auth" });
  }
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    flow.status = "error";
    flow.error = `Connexion refusee : ${oauthError}`;
    throw new AppError(flow.error, { code: "auth" });
  }
  const code = url.searchParams.get("code");
  if (!code) throw new AppError("Le callback OpenAI ne contient aucun code.", { code: "auth" });

  const tokens = await requestTokens({
    grant_type: "authorization_code",
    client_id: CHATGPT_OAUTH.clientId,
    code,
    redirect_uri: CHATGPT_OAUTH.redirectUri,
    code_verifier: flow.verifier,
  });
  if (!tokens.refresh_token) {
    throw new ProviderError("OpenAI n'a pas fourni de jeton de rafraichissement.", {
      code: "invalid_response",
    });
  }
  const credentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    ...identityFrom(tokens),
  };
  await saveCredentials(credentials);
  pendingFlows.delete(profileId);
  return { status: "connected", email: credentials.email };
}

/** Renvoie des jetons valides, en rafraichissant au besoin. */
export async function ensureAccessToken(context, { force = false } = {}) {
  const credentials = context.credentials;
  if (!credentials?.accessToken) {
    throw new ProviderError(`Le profil « ${context.label} » n'est pas connecte a ChatGPT.`, {
      code: "auth",
    });
  }
  if (!force && Date.now() < credentials.expiresAt - REFRESH_MARGIN_MS) return credentials;
  if (!credentials.refreshToken) {
    throw new ProviderError(`La session ChatGPT du profil « ${context.label} » a expire.`, {
      code: "auth",
    });
  }
  if (!pendingRefreshes.has(context.profileId)) {
    const refresh = requestTokens({
      grant_type: "refresh_token",
      client_id: CHATGPT_OAUTH.clientId,
      refresh_token: credentials.refreshToken,
    })
      .then(async (tokens) => {
        const identity = identityFrom(tokens);
        const refreshed = {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || credentials.refreshToken,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          accountId: identity.accountId || credentials.accountId || "",
          email: identity.email || credentials.email || "",
        };
        await context.saveCredentials(refreshed);
        return refreshed;
      })
      .finally(() => pendingRefreshes.delete(context.profileId));
    pendingRefreshes.set(context.profileId, refresh);
  }
  return pendingRefreshes.get(context.profileId);
}

/** Etat de connexion, pour la page d'options. */
export function authorizationStatus(profileId, credentials) {
  if (credentials?.accessToken) {
    return {
      status: "connected",
      email: credentials.email || "",
      accountId: credentials.accountId || "",
    };
  }
  const flow = pendingFlows.get(profileId);
  return flow ? { status: flow.status, error: flow.error } : { status: "disconnected" };
}

/** Retrouve le profil dont l'onglet de connexion vient d'atteindre le callback. */
export function flowForTab(tabId) {
  return [...pendingFlows.values()].find((flow) => flow.tabId === tabId) || null;
}

export function forgetFlow(profileId) {
  pendingFlows.delete(profileId);
  pendingRefreshes.delete(profileId);
}
