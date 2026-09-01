// Permissions d'origine. Une extension MV3 ne peut appeler un service distant
// que si l'utilisateur a autorise son origine. Sans ce controle, l'echec se
// presente comme une panne reseau incomprehensible ; avec lui, l'interface peut
// demander l'autorisation au bon moment.

import { createLogger } from "./logger.js";

const logger = createLogger("permissions");

function api() {
  return typeof messenger !== "undefined" ? messenger.permissions : null;
}

/** Motif d'origine attendu par l'API permissions, ex. « https://api.openai.com/* ». */
export function originPattern(url) {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return "";
  }
}

export async function hasOriginPermission(url) {
  const permissions = api();
  const origins = originPattern(url);
  if (!permissions || !origins) return true;
  try {
    return await permissions.contains({ origins: [origins] });
  } catch (error) {
    // Un motif refuse par l'API (localhost deja couvert par le manifeste, par
    // exemple) ne doit pas bloquer l'appel.
    logger.debug("Verification de permission impossible", { reason: error.message });
    return true;
  }
}

/**
 * Demande l'autorisation. Doit etre appelee depuis un geste utilisateur :
 * Thunderbird refuse silencieusement les demandes hors interaction.
 */
export async function requestOriginPermission(url) {
  const permissions = api();
  const origins = originPattern(url);
  if (!permissions || !origins) return true;
  return permissions.request({ origins: [origins] });
}
