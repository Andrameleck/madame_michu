// Regles de transport partagees entre la page d'options et le background.
// Les extraits de mails ne doivent jamais traverser Internet en clair.

const LOCAL_PROVIDER_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseProviderUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("L'URL du provider est invalide.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Le provider doit utiliser une URL HTTP(S) sans identifiants integres.");
  }
  return url;
}

function isLocalProviderUrl(value) {
  return LOCAL_PROVIDER_HOSTS.has(parseProviderUrl(value).hostname);
}

function normalizeProviderUrl(value) {
  const url = parseProviderUrl(value);
  if (url.protocol !== "https:" && !LOCAL_PROVIDER_HOSTS.has(url.hostname)) {
    throw new Error("Un provider distant doit utiliser HTTPS. HTTP est reserve a localhost.");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

function providerUsesRemoteService(profile) {
  if (profile?.type === "openai-codex") return true;
  return Boolean(profile?.baseUrl) && !isLocalProviderUrl(profile.baseUrl);
}
