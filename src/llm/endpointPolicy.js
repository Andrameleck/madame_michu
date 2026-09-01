// Regle de transport unique pour les endpoints LLM, partagee par la page
// d'options et le background. Un extrait de mail ne doit jamais traverser le
// reseau en clair : HTTP reste tolere pour la machine locale uniquement.

import { ConfigurationError } from "../core/errors.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function parse(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new ConfigurationError("L'URL du service est invalide.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ConfigurationError("Le service doit etre joignable en HTTP ou HTTPS.");
  }
  if (url.username || url.password) {
    throw new ConfigurationError("L'URL ne doit pas contenir d'identifiants.");
  }
  return url;
}

export function isLocalEndpoint(value) {
  try {
    return LOCAL_HOSTS.has(parse(value).hostname);
  } catch {
    return false;
  }
}

/** Valide et nettoie une URL de service ; leve si la regle HTTPS est violee. */
export function normalizeEndpoint(value) {
  const url = parse(value);
  if (url.protocol !== "https:" && !LOCAL_HOSTS.has(url.hostname)) {
    throw new ConfigurationError(
      "Un service distant doit utiliser HTTPS. HTTP est reserve a la machine locale."
    );
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

/** Un profil sort-il de la machine ? Determine le consentement a exiger. */
export function sendsDataOutside(descriptor, baseUrl) {
  if (!descriptor) return true;
  if (descriptor.auth === "oauth") return true;
  if (!descriptor.remote) return false;
  return !isLocalEndpoint(baseUrl || descriptor.defaultBaseUrl);
}
