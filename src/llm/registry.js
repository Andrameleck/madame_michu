// Catalogue des fournisseurs supportes. C'est l'unique endroit qui sait ce
// qu'un fournisseur exige et sait faire : la page d'options construit ses
// formulaires a partir de `fields`, la gateway lit `capabilities`, personne ne
// teste plus le type du profil a la main. Ajouter un fournisseur = ajouter une
// entree ici et un adaptateur, rien d'autre.

import { ollamaAdapter } from "./adapters/ollama.js";
import { openAiAdapter } from "./adapters/openai.js";
import { anthropicAdapter } from "./adapters/anthropic.js";
import { chatgptAdapter } from "./adapters/chatgpt.js";

/**
 * @typedef {object} ProviderField
 * @property {string} key      nom du champ dans le profil
 * @property {"text"|"password"|"model"|"oauth"} type
 * @property {string} label
 * @property {boolean} [required]
 * @property {string} [placeholder]
 * @property {string} [help]
 *
 * @typedef {object} ProviderDescriptor
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {"none"|"api-key"|"oauth"} auth
 * @property {boolean} remote           envoie des donnees hors de la machine
 * @property {string} defaultBaseUrl
 * @property {boolean} fixedBaseUrl     l'URL n'est pas modifiable par l'utilisateur
 * @property {{ tools: "native"|"none", toolFallback: boolean, jsonSchema: boolean, listModels: "api"|"static" }} capabilities
 * @property {ProviderField[]} fields
 * @property {import("./types.js").ProviderAdapter} adapter
 */

const BASE_URL_FIELD = {
  key: "baseUrl",
  type: "text",
  label: "URL du service",
  required: true,
};

const API_KEY_FIELD = {
  key: "apiKey",
  type: "password",
  label: "Cle API",
  required: true,
};

const MODEL_FIELD = {
  key: "model",
  type: "model",
  label: "Modele",
  required: true,
};

/** @type {Record<string, ProviderDescriptor>} */
export const PROVIDERS = Object.freeze({
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    description: "Modele execute sur ta machine. Aucun mail ne quitte l'ordinateur.",
    auth: "none",
    remote: false,
    defaultBaseUrl: "http://localhost:11434",
    fixedBaseUrl: false,
    capabilities: { tools: "native", toolFallback: true, jsonSchema: true, listModels: "api" },
    fields: [
      { ...BASE_URL_FIELD, placeholder: "http://localhost:11434" },
      MODEL_FIELD,
    ],
    adapter: ollamaAdapter,
  },

  openai: {
    id: "openai",
    label: "OpenAI ou API compatible",
    description:
      "OpenAI, Groq, Mistral, OpenRouter, LM Studio, vLLM : tout service exposant /chat/completions.",
    auth: "api-key",
    remote: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    fixedBaseUrl: false,
    capabilities: { tools: "native", toolFallback: true, jsonSchema: true, listModels: "api" },
    fields: [
      { ...BASE_URL_FIELD, placeholder: "https://api.openai.com/v1" },
      API_KEY_FIELD,
      MODEL_FIELD,
    ],
    adapter: openAiAdapter,
  },

  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    description: "API Claude a cle. Le JSON strict passe par un outil impose au modele.",
    auth: "api-key",
    remote: true,
    defaultBaseUrl: "https://api.anthropic.com",
    fixedBaseUrl: false,
    capabilities: { tools: "native", toolFallback: false, jsonSchema: true, listModels: "api" },
    fields: [
      { ...BASE_URL_FIELD, placeholder: "https://api.anthropic.com" },
      API_KEY_FIELD,
      MODEL_FIELD,
    ],
    adapter: anthropicAdapter,
  },

  chatgpt: {
    id: "chatgpt",
    label: "Abonnement ChatGPT (Plus / Pro)",
    description: "Connexion a ton compte ChatGPT par OAuth. Aucune cle API a saisir.",
    auth: "oauth",
    remote: true,
    defaultBaseUrl: "https://chatgpt.com/backend-api/codex",
    fixedBaseUrl: true,
    // Le backend Codex accepte mal les outils natifs selon les modeles : le
    // repli vers le protocole emule doit rester possible.
    capabilities: { tools: "native", toolFallback: true, jsonSchema: false, listModels: "static" },
    fields: [
      { key: "connection", type: "oauth", label: "Compte ChatGPT", required: true },
      MODEL_FIELD,
    ],
    adapter: chatgptAdapter,
  },
});

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

/** @returns {ProviderDescriptor|null} */
export function getProvider(providerId) {
  return PROVIDERS[providerId] || null;
}

/** Liste destinee au selecteur de la page d'options, sans les adaptateurs. */
export function describeProviders() {
  return PROVIDER_IDS.map((id) => {
    const { adapter, ...rest } = PROVIDERS[id];
    return rest;
  });
}
