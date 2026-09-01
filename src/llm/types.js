// Contrats partages de la couche LLM. Ce fichier ne contient que des typedefs :
// il documente la frontiere que chaque adaptateur doit respecter, sans code.

/**
 * @typedef {"system"|"user"|"assistant"|"tool"} MessageRole
 *
 * @typedef {object} ChatMessage
 * @property {MessageRole} role
 * @property {string} content            texte ; vide si le tour ne porte que des appels d'outil
 * @property {ToolCall[]} [toolCalls]    role "assistant" : outils demandes par le modele
 * @property {string} [toolCallId]       role "tool" : identifiant de l'appel auquel on repond
 * @property {string} [name]             role "tool" : nom de l'outil execute
 *
 * @typedef {object} ToolSpec
 * @property {string} name
 * @property {string} description
 * @property {object} parameters         JSON Schema de l'objet d'arguments
 *
 * @typedef {object} ToolCall
 * @property {string} id
 * @property {string} name
 * @property {object} arguments          deja parse ; jamais une chaine JSON brute
 *
 * @typedef {object} ChatRequest
 * @property {ChatMessage[]} messages
 * @property {ToolSpec[]} [tools]
 * @property {"auto"|"required"|"none"} [toolChoice]
 * @property {object} [responseSchema]   JSON Schema attendu ; active le mode JSON strict
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {number} [timeoutMs]
 * @property {AbortSignal} [signal]
 *
 * @typedef {object} ChatResponse
 * @property {string} text
 * @property {ToolCall[]} toolCalls
 * @property {"stop"|"tool_calls"|"length"|"unknown"} finishReason
 * @property {{ inputTokens?: number, outputTokens?: number }} [usage]
 * @property {string} model
 *
 * Contexte resolu d'un appel : profil, secret et reglages fusionnes. Les
 * adaptateurs ne voient que cela, jamais l'objet de configuration global.
 * @typedef {object} ProviderContext
 * @property {string} profileId
 * @property {string} label
 * @property {string} baseUrl
 * @property {string} model
 * @property {string} apiKey
 * @property {object} credentials        jetons OAuth, vide pour les autres modes
 * @property {object} options            reglages libres propres au profil
 * @property {(credentials: object) => Promise<void>} saveCredentials
 *
 * Un adaptateur est un objet sans etat. Toute la variabilite passe par le contexte.
 * @typedef {object} ProviderAdapter
 * @property {(context: ProviderContext, request: ChatRequest) => Promise<ChatResponse>} chat
 * @property {(context: ProviderContext) => Promise<string[]>} [listModels]
 */

export {};
