// Acces a la messagerie. C'est la seule frontiere avec `messenger.messages` :
// personne d'autre ne manipule d'identifiant Thunderbird brut ni de MessagePart.
//
// La recherche s'appuie entierement sur `messages.query`, l'index natif de
// Thunderbird. C'est ce qui permet de se passer d'une base vectorielle : le
// modele choisit des criteres, Thunderbird fait le travail d'indexation qu'il
// fait deja de toute facon.

import { HostError, toAppError } from "../core/errors.js";
import { createLogger } from "../core/logger.js";
import { htmlToText, stripQuotedText, truncate } from "./text.js";

const logger = createLogger("mail");


const MAX_PAGES = 20;
// Plafond de balayage avant tri. Assez large pour que « le plus ancien » soit
// juste sur une boite ordinaire, assez bas pour rester instantane.
const SCAN_CAP = 1000;
const BODY_CONCURRENCY = 6;

/**
 * @typedef {object} MailSummary
 * @property {string} id
 * @property {string} subject
 * @property {string} author
 * @property {string[]} recipients
 * @property {string} date          ISO 8601
 * @property {string} folder
 * @property {boolean} read
 * @property {boolean} flagged
 * @property {boolean} hasAttachments
 *
 * @typedef {MailSummary & { body: string }} MailMessage
 */

function api() {
  if (typeof messenger === "undefined" || !messenger.messages) {
    throw new HostError("L'API de messagerie de Thunderbird est indisponible.", { code: "internal" });
  }
  return messenger;
}

function normalizeHeader(header) {
  return {
    id: String(header.id),
    subject: header.subject || "(sans objet)",
    author: header.author || "",
    recipients: header.recipients || [],
    date: header.date instanceof Date ? header.date.toISOString() : new Date(header.date).toISOString(),
    folder: header.folder?.name || header.folder?.path || "",
    read: header.read === true,
    flagged: header.flagged === true,
    hasAttachments: header.attachments === true || header.hasAttachment === true,
  };
}

/**
 * Recherche des messages. Les criteres sont volontairement ceux de l'API
 * Thunderbird : ce sont eux que le modele manipule via l'outil de recherche.
 * @param {object} criteria
 * @param {{ limit?: number, sort?: "desc"|"asc", scanCap?: number }} [options]
 * @returns {Promise<MailSummary[] & { scanned: number, truncated: boolean }>}
 */
export async function queryMessages(criteria = {}, { limit = 50, sort = "desc", scanCap = SCAN_CAP } = {}) {
  const host = api();
  const query = { ...criteria };
  if (query.fromDate) query.fromDate = new Date(query.fromDate);
  if (query.toDate) query.toDate = new Date(query.toDate);

  let page;
  try {
    page = await host.messages.query(query);
  } catch (error) {
    throw new HostError("La recherche dans la messagerie a echoue.", {
      code: "internal",
      cause: toAppError(error),
    });
  }

  // Thunderbird ne garantit aucun ordre de restitution. S'arreter des qu'on a
  // `limit` messages renvoie donc un echantillon arbitraire, pas les plus
  // recents : il faut balayer, puis trier, puis couper.
  const collected = [];
  let truncated = false;
  for (let pages = 0; page && pages < MAX_PAGES; pages += 1) {
    for (const header of page.messages || []) collected.push(normalizeHeader(header));
    if (collected.length >= scanCap || !page.id) {
      truncated = collected.length >= scanCap && Boolean(page.id);
      // Une liste qu'on cesse de lire continue a se remplir en arriere-plan :
      // il faut l'interrompre explicitement.
      if (page.id) await host.messages.abortList(page.id).catch(() => {});
      break;
    }
    page = await host.messages.continueList(page.id).catch(() => null);
  }

  const direction = sort === "asc" ? 1 : -1;
  collected.sort((left, right) => direction * left.date.localeCompare(right.date));
  const results = collected.slice(0, limit);
  // La troncature doit remonter : sans elle, « le plus ancien » d'un balayage
  // partiel serait presente comme le plus ancien de la boite.
  results.scanned = collected.length;
  results.truncated = truncated;
  return results;
}

/** Extrait le premier corps texte d'un MessagePart, HTML converti au besoin. */
function extractBody(part) {
  if (!part) return "";
  const plain = findPart(part, "text/plain");
  if (plain?.body) return plain.body;
  const html = findPart(part, "text/html");
  return html?.body ? htmlToText(html.body) : "";
}

function findPart(part, contentType) {
  if (part.contentType?.startsWith(contentType)) return part;
  for (const child of part.parts || []) {
    const found = findPart(child, contentType);
    if (found) return found;
  }
  return null;
}

/**
 * Lit un message complet, corps nettoye et tronque.
 * @param {string} id
 * @param {{ maxChars?: number, keepQuotes?: boolean }} [options]
 * @returns {Promise<MailMessage>}
 */
export async function readMessage(id, { maxChars = 4000, keepQuotes = false } = {}) {
  const host = api();
  const [header, full] = await Promise.all([
    host.messages.get(Number(id)),
    host.messages.getFull(Number(id)),
  ]);
  const raw = extractBody(full);
  const body = keepQuotes ? raw : stripQuotedText(raw);
  return { ...normalizeHeader(header), body: truncate(body, maxChars) };
}

/** Lit plusieurs messages en limitant la concurrence imposee a Thunderbird. */
export async function readMessages(ids, options = {}) {
  const queue = [...ids];
  const results = [];
  const workers = Array.from({ length: Math.min(BODY_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        results.push(await readMessage(id, options));
      } catch (error) {
        logger.warn("Message illisible, ignore", { id, reason: toAppError(error).message });
      }
    }
  });
  await Promise.all(workers);
  results.sort((left, right) => right.date.localeCompare(left.date));
  return results;
}

/** Comptes de messagerie configures, sans leurs dossiers. */
export async function listAccounts() {
  const accounts = await api().accounts.list(false);
  return accounts.map((account) => ({ id: account.id, name: account.name, type: account.type }));
}

/** Dossiers d'un compte, aplatis, avec leur usage special quand il existe. */
export async function listFolders(accountId) {
  const host = api();
  const accounts = accountId
    ? [await host.accounts.get(accountId, true)]
    : await host.accounts.list(true);
  const folders = [];
  const walk = (list, accountName) => {
    for (const folder of list || []) {
      folders.push({
        id: folder.id,
        name: folder.name,
        path: folder.path,
        accountId: folder.accountId,
        accountName,
        specialUse: folder.specialUse || [],
      });
      walk(folder.subFolders, accountName);
    }
  };
  for (const account of accounts.filter(Boolean)) {
    walk(account.folders || account.rootFolder?.subFolders, account.name);
  }
  return folders;
}

/** Identites de l'utilisateur : sert a savoir qui est « moi ». */
export async function listIdentities() {
  const accounts = await api().accounts.list(false);
  return accounts.flatMap((account) =>
    (account.identities || []).map((identity) => ({
      id: identity.id,
      email: identity.email || "",
      name: identity.name || "",
      accountId: account.id,
    }))
  );
}

/**
 * Perimetre du chat : toute la messagerie.
 *
 * Le chat ne partage pas le perimetre des rapports. Les reglages de dossiers et
 * de periode servent a borner le volume d'un rapport quotidien ; les appliquer a
 * une question rendrait la recherche inutile — on ne peut pas retrouver un vieux
 * message dans un perimetre limite a la boite de reception du jour.
 *
 * Seule la selection de comptes est respectee : c'est une restriction que
 * l'utilisateur a posee volontairement, pas une limite de volume.
 */
export function resolveChatScope(config) {
  const mail = config?.mail || {};
  if (mail.allAccounts === false && mail.accountIds?.length) {
    return { accountId: [...mail.accountIds] };
  }
  return {};
}

/** Dossiers a fouiller pour un rapport, ou {} pour « partout ». */
export async function resolveScope(config) {
  const mail = config.mail || {};
  if (mail.allFolders) {
    return mail.allAccounts ? {} : { accountId: mail.accountIds };
  }
  const folders = await listFolders();
  const wanted = new Set((mail.folders || ["inbox"]).map((name) => name.toLowerCase()));
  const selected = folders.filter((folder) => {
    if (mail.allAccounts === false && !mail.accountIds?.includes(folder.accountId)) return false;
    const use = (folder.specialUse || []).map((value) => value.toLowerCase());
    return use.some((value) => wanted.has(value)) || wanted.has(folder.name.toLowerCase());
  });
  if (!selected.length) return mail.allAccounts ? {} : { accountId: mail.accountIds };
  return { folderId: selected.map((folder) => folder.id) };
}
