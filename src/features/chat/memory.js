// Memoire de conversation. Deux niveaux : les tours recents sont conserves mot
// pour mot, les plus anciens sont condenses en un resume. Sans ce repli, une
// longue conversation finit par saturer la fenetre de contexte du modele et
// l'extension se met a oublier brutalement le debut de l'echange.

import { read, write } from "../../core/storage.js";
import { chat } from "../../llm/gateway.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("chat");
const STATE_KEY = "conversations";
const MAX_CONVERSATIONS = 20;

/**
 * @typedef {object} Conversation
 * @property {string} id
 * @property {string} title
 * @property {string} summary            resume des tours retires de l'historique
 * @property {{ role: string, content: string, at: string }[]} messages
 * @property {string} updatedAt
 */

export async function listConversations() {
  const stored = (await read(STATE_KEY, {})) || {};
  return Object.values(stored).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** @returns {Promise<Conversation>} */
export async function getConversation(id) {
  const stored = (await read(STATE_KEY, {})) || {};
  return stored[id] || { id, title: "", summary: "", messages: [], updatedAt: new Date().toISOString() };
}

export async function saveConversation(conversation) {
  const stored = (await read(STATE_KEY, {})) || {};
  stored[conversation.id] = { ...conversation, updatedAt: new Date().toISOString() };
  // Le stockage local d'une extension n'est pas un entrepot : on ne garde que
  // les conversations recentes.
  const kept = Object.values(stored)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_CONVERSATIONS);
  await write(STATE_KEY, Object.fromEntries(kept.map((item) => [item.id, item])));
}

export async function deleteConversation(id) {
  const stored = (await read(STATE_KEY, {})) || {};
  delete stored[id];
  await write(STATE_KEY, stored);
}

/** Premiere question de l'utilisateur, tronquee : suffit a identifier un fil. */
export function titleFrom(question) {
  return String(question).replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * Ramene l'historique sous la limite en condensant les tours les plus anciens.
 * @param {Conversation} conversation
 * @param {number} keepTurns nombre de messages recents conserves intacts
 */
export async function compact(conversation, keepTurns, { config } = {}) {
  const limit = Math.max(4, keepTurns * 2);
  if (conversation.messages.length <= limit) return conversation;

  const olds = conversation.messages.slice(0, conversation.messages.length - limit);
  const recents = conversation.messages.slice(-limit);
  const transcript = olds.map((message) => `${message.role} : ${message.content}`).join("\n");

  try {
    const response = await chat({
      messages: [
        {
          role: "system",
          content: "Condense cet extrait de conversation en 5 phrases maximum. Garde les faits, "
            + "les noms, les dates et les decisions ; supprime les formules de politesse.",
        },
        {
          role: "user",
          content: `${conversation.summary ? `Resume precedent :\n${conversation.summary}\n\n` : ""}${transcript}`,
        },
      ],
    }, { config });
    return { ...conversation, summary: response.text.trim(), messages: recents };
  } catch (error) {
    // Un resume rate ne doit pas bloquer la conversation : on coupe simplement.
    logger.warn("Compactage de la memoire impossible, troncature simple", { reason: error.message });
    return { ...conversation, messages: recents };
  }
}

/** Messages a envoyer au modele : resume ancien puis tours recents. */
export function toPromptMessages(conversation, keepTurns) {
  const recents = conversation.messages.slice(-keepTurns * 2);
  return [
    ...(conversation.summary
      ? [{ role: "user", content: `Rappel des echanges precedents :\n${conversation.summary}` }]
      : []),
    ...recents.map((message) => ({ role: message.role, content: message.content })),
  ];
}
