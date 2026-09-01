// Boucle d'agent : le modele demande des outils, on les execute, on lui rend
// les resultats, jusqu'a ce qu'il reponde. C'est le seul endroit de
// l'application qui orchestre plusieurs tours de LLM.
//
// Le moteur ignore tout du fournisseur : la gateway a deja ramene les appels
// d'outils a une forme unique, qu'ils soient natifs ou emules.

import { AppError } from "../core/errors.js";
import { createLogger } from "../core/logger.js";
import { chat, TIMEOUTS } from "../llm/gateway.js";
import { serializeToolResult } from "./toolRegistry.js";

const logger = createLogger("agent");

const DEFAULT_MAX_STEPS = 6;

/**
 * @typedef {object} AgentStep
 * @property {string} tool
 * @property {object} arguments
 * @property {boolean} ok
 * @property {any} result
 *
 * @typedef {object} AgentOutcome
 * @property {string} text
 * @property {AgentStep[]} steps
 * @property {string} profileId
 * @property {boolean} exhausted   vrai si la limite de tours a ete atteinte
 */

/**
 * @param {{
 *   system: string,
 *   messages: import("../llm/types.js").ChatMessage[],
 *   toolset: ReturnType<import("./toolRegistry.js").createToolset>,
 *   context?: object,
 *   config?: object,
 *   maxSteps?: number,
 *   signal?: AbortSignal,
 *   onStep?: (step: AgentStep) => void,
 * }} options
 * @returns {Promise<AgentOutcome>}
 */
export async function runAgent({
  system,
  messages,
  toolset,
  context = {},
  config,
  maxSteps = DEFAULT_MAX_STEPS,
  signal,
  onStep,
}) {
  const conversation = [
    ...(system ? [{ role: "system", content: system }] : []),
    ...messages,
  ];
  const steps = [];
  let profileId = "";

  for (let turn = 0; turn < maxSteps; turn += 1) {
    const response = await chat({
      messages: conversation,
      tools: toolset.specs,
      timeoutMs: TIMEOUTS.tool,
      signal,
    }, { config });
    profileId = response.profileId;

    if (!response.toolCalls.length) {
      return { text: response.text.trim(), steps, profileId, exhausted: false };
    }

    conversation.push({
      role: "assistant",
      content: response.text || "",
      toolCalls: response.toolCalls,
    });

    for (const call of response.toolCalls) {
      if (signal?.aborted) throw new AppError("Operation interrompue.", { code: "aborted" });
      const outcome = await toolset.run(call, context);
      const step = { tool: call.name, arguments: call.arguments, ok: outcome.ok, result: outcome.result };
      steps.push(step);
      onStep?.(step);
      conversation.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: serializeToolResult(outcome),
      });
    }
  }

  // Limite atteinte : on redemande une reponse, sans outil cette fois, pour ne
  // pas laisser l'utilisateur devant un echec alors que des donnees ont ete
  // collectees.
  logger.warn("Limite de tours atteinte, demande de synthese", { steps: steps.length });
  const closing = await chat({
    messages: [
      ...conversation,
      {
        role: "user",
        content: "Tu as atteint la limite de recherches. Reponds maintenant avec ce que tu as trouve, "
          + "et dis clairement ce qui te manque.",
      },
    ],
    timeoutMs: TIMEOUTS.chat,
    signal,
  }, { config });

  return { text: closing.text.trim(), steps, profileId: closing.profileId, exhausted: true };
}
