// Emulation d'appels d'outils pour les modeles qui n'en supportent pas
// nativement — cas frequent des petits modeles Ollama. Le protocole est un
// simple objet JSON : le modele choisit soit un outil et ses arguments, soit sa
// reponse finale. Le reste de l'application ne voit pas la difference, elle
// recoit dans les deux cas des `toolCalls` normalises.

const PROTOCOL_HEADER = `Tu disposes d'outils pour consulter la messagerie et l'agenda.
Reponds TOUJOURS par un unique objet JSON, sans texte autour et sans bloc de code.

Pour utiliser un outil :
{"action": "tool", "tool": "<nom>", "arguments": { ... }}

Pour repondre a l'utilisateur :
{"action": "answer", "content": "<ta reponse>"}

Un seul outil par tour. Enchaine les appels jusqu'a disposer des informations
necessaires, puis termine par une action "answer".

Outils disponibles :`;

/** Schema impose quand le fournisseur sait contraindre sa sortie. */
export const EMULATION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    action: { type: "string", enum: ["tool", "answer"] },
    tool: { type: "string" },
    arguments: { type: "object" },
    content: { type: "string" },
  },
  required: ["action"],
});

function describeTools(tools) {
  return tools
    .map((tool) => `- ${tool.name} : ${tool.description}\n  arguments : ${JSON.stringify(tool.parameters?.properties ?? {})}`)
    .join("\n");
}

/**
 * Transforme une requete a outils natifs en requete textuelle equivalente.
 * @param {import("./types.js").ChatRequest} request
 * @param {{ jsonSchema: boolean }} capabilities
 */
export function emulateRequest(request, { jsonSchema = false } = {}) {
  const tools = request.tools || [];
  const instructions = `${PROTOCOL_HEADER}\n${describeTools(tools)}`;

  const messages = [];
  let systemInjected = false;
  for (const message of request.messages) {
    if (message.role === "system" && !systemInjected) {
      messages.push({ role: "system", content: `${message.content}\n\n${instructions}` });
      systemInjected = true;
      continue;
    }
    if (message.role === "tool") {
      // Sans support natif, un role "tool" est refuse par la plupart des
      // services : le resultat devient une observation utilisateur.
      messages.push({
        role: "user",
        content: `Resultat de l'outil ${message.name || "inconnu"} :\n${message.content}`,
      });
      continue;
    }
    if (message.toolCalls?.length) {
      const call = message.toolCalls[0];
      messages.push({
        role: "assistant",
        content: JSON.stringify({ action: "tool", tool: call.name, arguments: call.arguments }),
      });
      continue;
    }
    messages.push({ role: message.role, content: message.content });
  }
  if (!systemInjected) messages.unshift({ role: "system", content: instructions });

  return {
    ...request,
    messages,
    tools: undefined,
    toolChoice: undefined,
    ...(jsonSchema ? { responseSchema: EMULATION_SCHEMA } : {}),
  };
}

/** Isole le premier objet JSON d'une reponse, meme entoure de texte ou de ```. */
export function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  if (start < 0) return null;
  // Balayage avec suivi des chaines : un JSON contenant des accolades dans une
  // valeur textuelle casse toute approche par expression reguliere.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Relit une reponse emulee et la ramene a la forme commune.
 * @param {import("./types.js").ChatResponse} response
 * @param {import("./types.js").ToolSpec[]} tools
 * @returns {import("./types.js").ChatResponse}
 */
export function parseEmulatedResponse(response, tools = []) {
  const parsed = extractJsonObject(response.text);
  const known = new Set(tools.map((tool) => tool.name));

  if (parsed?.action === "tool" && known.has(parsed.tool)) {
    return {
      ...response,
      text: "",
      toolCalls: [{
        id: `emulated_${Date.now().toString(36)}`,
        name: parsed.tool,
        arguments: typeof parsed.arguments === "object" && parsed.arguments ? parsed.arguments : {},
      }],
      finishReason: "tool_calls",
    };
  }
  if (parsed?.action === "answer" && typeof parsed.content === "string") {
    return { ...response, text: parsed.content, toolCalls: [], finishReason: "stop" };
  }
  // Le modele a repondu en clair au lieu de suivre le protocole : sa reponse
  // reste utilisable, on la prend telle quelle plutot que d'echouer.
  return { ...response, toolCalls: [], finishReason: "stop" };
}

const TOOL_REJECTION_PATTERN = /tool|function[_ ]call|does not support/i;

/** Le service a-t-il refuse la requete parce qu'il ignore les outils ? */
export function looksLikeToolRejection(error) {
  if (!error) return false;
  // Un adaptateur peut le savoir de source sure : sa parole prime sur l'analyse
  // du message d'erreur.
  if (error.code === "unsupported") return true;
  const status = error.details?.status;
  if (status !== 400 && status !== 404 && status !== 422 && status !== 500) return false;
  return TOOL_REJECTION_PATTERN.test(error.message || "");
}
