// Outils de messagerie. Les descriptions sont ecrites pour le modele : ce sont
// elles qui lui apprennent a formuler une recherche, puisque c'est lui qui
// choisit ses mots-cles. Aucun index maison n'intervient, `messages.query`
// s'appuie sur l'index natif de Thunderbird.

import { defineTool } from "../toolRegistry.js";
import { queryMessages, readMessage } from "../../mail/repository.js";
import { truncate } from "../../mail/text.js";

const MAX_SEARCH_RESULTS = 25;

/** Date ISO du jour, decalee de `days`, en heure locale. */
function isoDay(days = 0, now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function toCriteria(args, scope) {
  const criteria = { ...scope };
  if (args.keywords) criteria.fullText = args.keywords;
  if (args.author) criteria.author = args.author;
  if (args.subject) criteria.subject = args.subject;
  if (args.recipient) criteria.recipients = args.recipient;
  if (args.body) criteria.body = args.body;
  if (args.unread_only) criteria.read = false;
  if (args.flagged_only) criteria.flagged = true;
  if (args.with_attachment) criteria.attachment = true;

  if (args.since_days) criteria.fromDate = new Date(`${isoDay(-args.since_days)}T00:00:00`);
  if (args.from_date) criteria.fromDate = new Date(`${args.from_date}T00:00:00`);
  if (args.to_date) criteria.toDate = new Date(`${args.to_date}T23:59:59`);
  return criteria;
}

const FILTER_LABELS = {
  keywords: "mots-cles",
  author: "expediteur",
  recipient: "destinataire",
  subject: "objet",
  body: "corps",
  since_days: "derniers jours",
  from_date: "a partir du",
  to_date: "jusqu'au",
  unread_only: "non lus seulement",
  flagged_only: "suivis seulement",
  with_attachment: "avec piece jointe",
};

function describeFilters(args) {
  const applied = Object.entries(FILTER_LABELS)
    .filter(([key]) => args[key] !== undefined && args[key] !== "" && args[key] !== false)
    .map(([key, label]) => `${label} = ${args[key]}`);
  return applied.length ? applied.join(", ") : "aucun (toute la messagerie accessible)";
}

/**
 * Un tri par anciennete combine a une restriction de periode donne le plus
 * ancien de cette periode, ce que le modele presente volontiers comme le plus
 * ancien de la boite. On le lui dit explicitement plutot que d'esperer.
 */
function warnAboutFilters(args) {
  const restrictions = ["since_days", "from_date", "keywords", "author", "subject", "body"]
    .filter((key) => args[key]);
  if (!restrictions.length) return "";
  if (args.sort !== "ancien" && args.sort !== "recent") return "";
  const kind = args.sort === "ancien" ? "le plus ancien" : "le plus recent";
  return `Attention : ${kind} message ci-dessus est ${kind} PARMI les resultats filtres `
    + `(${restrictions.join(", ")}), pas de toute la messagerie. Pour un extremum absolu, `
    + "relance la recherche sans aucun critere.";
}

export const searchMailTool = defineTool({
  name: "search_mail",
  description:
    "Cherche des messages dans la messagerie de l'utilisateur. Combine les criteres qui te semblent "
    + "utiles ; laisse vides ceux dont tu n'as pas besoin. `keywords` cherche a la fois dans l'objet, "
    + "le corps et l'expediteur : c'est le critere a privilegier. Renvoie une liste de messages sans "
    + "leur contenu ; utilise read_mail pour lire un message qui semble pertinent. "
    + "Si la recherche ne donne rien, reformule avec d'autres mots-cles ou elargis la periode. "
    + "La recherche couvre par defaut TOUTE la messagerie : tous les dossiers, toutes les annees, "
    + "sans limite de date. Chaque critere que tu ajoutes la restreint. "
    + "Pour trouver le message le plus ancien ou le plus recent de la messagerie, n'indique AUCUN "
    + "critere de date et AUCUN mot-cle, seulement `sort` : combiner `sort` avec `since_days` ne "
    + "donne que le plus ancien de la periode choisie.",
  parameters: {
    type: "object",
    properties: {
      keywords: { type: "string", description: "Mots-cles cherches dans l'objet, le corps et l'expediteur." },
      author: { type: "string", description: "Nom ou adresse de l'expediteur." },
      recipient: { type: "string", description: "Nom ou adresse d'un destinataire." },
      subject: { type: "string", description: "Fragment de l'objet uniquement." },
      body: { type: "string", description: "Fragment cherche dans le corps uniquement." },
      since_days: {
        type: "integer",
        description: "Ne garder que les messages des N derniers jours.",
        minimum: 1,
        maximum: 3650,
      },
      from_date: { type: "string", description: "Date de debut incluse, format AAAA-MM-JJ." },
      to_date: { type: "string", description: "Date de fin incluse, format AAAA-MM-JJ." },
      unread_only: { type: "boolean", description: "Ne garder que les messages non lus." },
      flagged_only: { type: "boolean", description: "Ne garder que les messages suivis (etoile)." },
      with_attachment: { type: "boolean", description: "Ne garder que les messages avec piece jointe." },
      sort: {
        type: "string",
        enum: ["recent", "ancien"],
        description: "Ordre des resultats : « recent » d'abord (defaut), ou « ancien » d'abord. "
          + "Utilise « ancien » pour toute question sur le plus vieux message ou le debut d'un echange.",
      },
      limit: { type: "integer", description: "Nombre maximum de resultats (defaut 15).", minimum: 1, maximum: 25 },
    },
  },
  risk: "read",
  async handler(args, context) {
    const criteria = toCriteria(args, context.scope || {});
    const limit = Math.min(args.limit || 15, MAX_SEARCH_RESULTS);
    const messages = await queryMessages(criteria, {
      limit,
      sort: args.sort === "ancien" ? "asc" : "desc",
    });
    return {
      trouves: messages.length,
      messages_parcourus: messages.scanned,
      // Le modele oublie facilement ses propres filtres et presente un extremum
      // local comme un extremum absolu. On lui renvoie donc ce qu'il a demande.
      filtres_appliques: describeFilters(args),
      ...(warnAboutFilters(args) ? { avertissement: warnAboutFilters(args) } : {}),
      ...(messages.truncated
        ? {
            avertissement_volume: `La recherche s'est arretee apres ${messages.scanned} messages. `
              + "Il peut en exister d'autres : affine les criteres avant de conclure.",
          }
        : {}),
      messages: messages.map((message) => ({
        id: message.id,
        date: message.date.slice(0, 16).replace("T", " "),
        de: message.author,
        objet: message.subject,
        lu: message.read,
        piece_jointe: message.hasAttachments,
      })),
    };
  },
});

export const readMailTool = defineTool({
  name: "read_mail",
  description:
    "Lit le contenu d'un message a partir de son identifiant, obtenu via search_mail. "
    + "Le corps est nettoye des citations et signatures. Ne lis que les messages reellement utiles.",
  parameters: {
    type: "object",
    properties: {
      message_id: { type: "string", description: "Identifiant renvoye par search_mail." },
      max_chars: {
        type: "integer",
        description: "Longueur maximale du corps renvoye (defaut 3000).",
        minimum: 200,
        maximum: 20000,
      },
    },
    required: ["message_id"],
  },
  risk: "read",
  async handler(args) {
    const message = await readMessage(args.message_id, { maxChars: args.max_chars || 3000 });
    return {
      id: message.id,
      date: message.date,
      de: message.author,
      a: message.recipients,
      objet: message.subject,
      dossier: message.folder,
      contenu: truncate(message.body, args.max_chars || 3000),
    };
  },
});

export const recentMailTool = defineTool({
  name: "list_recent_mail",
  description:
    "Liste les messages recus recemment, sans filtre de mots-cles. Utile pour une vue d'ensemble "
    + "(« qu'ai-je recu aujourd'hui ? ») plutot que pour une recherche precise.",
  parameters: {
    type: "object",
    properties: {
      since_days: { type: "integer", description: "Profondeur en jours (defaut 1).", minimum: 1, maximum: 90 },
      unread_only: { type: "boolean", description: "Ne garder que les non lus." },
      limit: { type: "integer", description: "Nombre maximum de messages (defaut 20).", minimum: 1, maximum: 50 },
    },
  },
  risk: "read",
  async handler(args, context) {
    const criteria = toCriteria({ since_days: args.since_days || 1, unread_only: args.unread_only }, context.scope || {});
    const messages = await queryMessages(criteria, { limit: Math.min(args.limit || 20, 50) });
    return {
      periode: `depuis le ${isoDay(-(args.since_days || 1))}`,
      trouves: messages.length,
      messages: messages.map((message) => ({
        id: message.id,
        date: message.date.slice(0, 16).replace("T", " "),
        de: message.author,
        objet: message.subject,
        lu: message.read,
      })),
    };
  },
});

export const mailTools = [searchMailTool, readMailTool, recentMailTool];
