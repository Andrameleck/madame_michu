// Declaration et execution des outils mis a disposition du modele.
//
// Un outil est une fonction JavaScript ordinaire plus un schema. Le schema part
// vers le modele, la fonction ne s'execute que sur des arguments valides. Cette
// separation est ce qui rend l'ajout d'une capacite peu couteux : une entree
// dans un jeu d'outils, rien a modifier dans le moteur.

import { AppError, toAppError } from "../core/errors.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("agent");

/** Volume maximal d'un resultat d'outil renvoye au modele. */
const MAX_RESULT_CHARS = 12_000;

/**
 * @typedef {object} ToolDefinition
 * @property {string} name          en snake_case : c'est ce que le modele ecrit
 * @property {string} description   redigee pour le modele, pas pour un humain
 * @property {object} parameters    JSON Schema de l'objet d'arguments
 * @property {"read"|"write"} risk  un outil "write" modifie les donnees de l'utilisateur
 * @property {(args: object, context: object) => Promise<any>} handler
 */

/** @param {ToolDefinition} definition */
export function defineTool(definition) {
  if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
    throw new AppError(`Nom d'outil invalide : ${definition.name}`, { code: "internal" });
  }
  return { risk: "read", ...definition };
}

/**
 * Validation minimale d'un objet d'arguments contre son schema : types de base,
 * champs requis, enums. Il ne s'agit pas d'implementer JSON Schema, seulement
 * d'empecher qu'un modele approximatif fasse planter un handler.
 */
export function coerceArguments(schema, args) {
  const properties = schema?.properties || {};
  const output = {};
  for (const [key, spec] of Object.entries(properties)) {
    const value = args?.[key];
    if (value === undefined || value === null || value === "") continue;
    output[key] = coerceValue(spec, value);
  }
  const missing = (schema?.required || []).filter((key) => output[key] === undefined);
  if (missing.length) {
    throw new AppError(`Arguments manquants : ${missing.join(", ")}.`, { code: "invalid_response" });
  }
  return output;
}

function coerceValue(spec, value) {
  switch (spec?.type) {
    case "integer":
    case "number": {
      const number = Number(value);
      if (Number.isNaN(number)) throw new AppError("Valeur numerique attendue.", { code: "invalid_response" });
      const clamped = Math.min(spec.maximum ?? Infinity, Math.max(spec.minimum ?? -Infinity, number));
      return spec.type === "integer" ? Math.round(clamped) : clamped;
    }
    case "boolean":
      return value === true || value === "true";
    case "array": {
      const list = Array.isArray(value) ? value : [value];
      return list.map((item) => coerceValue(spec.items || {}, item));
    }
    case "string": {
      const text = String(value);
      if (spec.enum && !spec.enum.includes(text)) {
        throw new AppError(
          `Valeur « ${text} » hors des choix autorises (${spec.enum.join(", ")}).`,
          { code: "invalid_response" }
        );
      }
      return text;
    }
    default:
      return value;
  }
}

/**
 * Assemble un jeu d'outils utilisable par le moteur.
 * @param {ToolDefinition[]} definitions
 */
export function createToolset(definitions) {
  const byName = new Map(definitions.map((tool) => [tool.name, tool]));

  return {
    /** Specifications envoyees au modele. */
    get specs() {
      return definitions.map(({ name, description, parameters }) => ({ name, description, parameters }));
    },

    has: (name) => byName.has(name),

    /**
     * Execute un appel d'outil. N'echoue jamais : une erreur devient un
     * resultat que le modele peut lire et corriger au tour suivant.
     * @param {import("../llm/types.js").ToolCall} call
     * @param {object} context
     */
    async run(call, context = {}) {
      const tool = byName.get(call.name);
      if (!tool) {
        return { ok: false, error: `Outil inconnu : ${call.name}.` };
      }
      try {
        const args = coerceArguments(tool.parameters, call.arguments);
        const started = Date.now();
        const result = await tool.handler(args, context);
        logger.debug("Outil execute", {
          tool: tool.name,
          durationMs: Date.now() - started,
          risk: tool.risk,
        });
        return { ok: true, result };
      } catch (error) {
        const appError = toAppError(error);
        logger.warn("Outil en echec", { tool: call.name, code: appError.code });
        return { ok: false, error: appError.message };
      }
    },
  };
}

/** Serialise un resultat pour le renvoyer au modele, taille bornee. */
export function serializeToolResult(outcome) {
  const payload = outcome.ok ? outcome.result : { erreur: outcome.error };
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n[... resultat tronque, affine ta recherche ...]`;
}
