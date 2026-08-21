// Recuperation des mails par periode via messenger.messages.query(), extraction du
// contenu texte, et troncature pour rester dans une fenetre de contexte raisonnable.

const MAIL_API_TIMEOUT_MS = 30_000;
const MAIL_FETCH_BUDGET_MS = 60_000;
const MAX_MESSAGE_PAGES = 250;
const ALL_FOLDERS_SELECTOR = "*";
const EXCLUDED_AUTOMATIC_FOLDER_USES = new Set([
  "drafts",
  "junk",
  "outbox",
  "sent",
  "templates",
  "trash",
]);

function withMailApiTimeout(promise, label, deadline = Infinity) {
  let timeoutId;
  const timeoutMs = Math.max(1, Math.min(MAIL_API_TIMEOUT_MS, deadline - Date.now()));
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} a depasse le delai autorise.`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function ensureMailFetchBudget(deadline) {
  if (Date.now() >= deadline) {
    throw new Error("La lecture des mails a depasse 60 secondes.");
  }
}

async function listAccountFolders(folderNames, deadline = Infinity) {
  const allFolders = await withMailApiTimeout(
    messenger.folders.query({}),
    "La lecture des dossiers Thunderbird",
    deadline
  );
  const selectors = (folderNames || []).map(normalizeFolderSelector).filter(Boolean);
  const scanAllFolders = selectors.includes(ALL_FOLDERS_SELECTOR);
  const matched = allFolders.filter((folder) => scanAllFolders
    ? isAutomaticallyScannableFolder(folder)
    : selectors.some((selector) => folderMatchesSelector(folder, selector))
  );
  return [...new Map(matched.map((folder) => [folder.id, folder])).values()];
}

function isAutomaticallyScannableFolder(folder) {
  if (!folder?.id || folder.isRoot || folder.type === "virtual") return false;
  const specialUses = (folder.specialUse || []).map(normalizeFolderSelector);
  return !specialUses.some((specialUse) => EXCLUDED_AUTOMATIC_FOLDER_USES.has(specialUse));
}

function normalizeFolderSelector(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLocaleLowerCase();
}

function folderMatchesSelector(folder, selector) {
  const candidates = [folder.id, folder.name, folder.path].map(normalizeFolderSelector);
  const specialUses = (folder.specialUse || []).map(normalizeFolderSelector);
  return candidates.includes(selector) || specialUses.includes(selector);
}

function attachFetchDiagnostics(emails, { requestedFolders, folders, sinceDate, candidateCount = 0 }) {
  Object.defineProperty(emails, "diagnostics", {
    enumerable: false,
    value: {
      requestedFolders: [...(requestedFolders || [])],
      matchedFolders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        path: folder.path,
        specialUse: folder.specialUse || [],
      })),
      sinceDate: sinceDate.toISOString(),
      emailCount: emails.length,
      candidateCount,
    },
  });
  return emails;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfSummaryRange(range, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "day") {
    start.setDate(start.getDate() - 1);
  } else if (range === "week") {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  } else if (range === "month") {
    start.setDate(1);
  }
  return start;
}

function stableMessageId(header, folder) {
  const accountId = folder.accountId || "unknown-account";
  const headerMessageId = String(header.headerMessageId || "").trim();
  return headerMessageId
    ? `${accountId}:${headerMessageId}`
    : `${accountId}:${folder.id}:${header.id}`;
}

async function fetchTodaysEmails({ folderNames, maxEmails, maxBodyChars }) {
  return fetchEmails({ folderNames, maxEmails, maxBodyChars, sinceDate: startOfToday() });
}

async function fetchSummaryEmails({ range, folderNames, maxEmails, maxBodyChars }) {
  return fetchEmails({
    folderNames,
    maxEmails,
    maxBodyChars,
    sinceDate: startOfSummaryRange(range),
  });
}

// Version generique : fenetre de dates arbitraire, et possibilite d'exclure des
// ids deja traites (utilise par l'indexation du chat pour ne pas re-parcourir
// les mails deja embeddes).
async function fetchEmails({ folderNames, maxEmails, maxBodyChars, sinceDate, excludeIds }) {
  const deadline = Date.now() + MAIL_FETCH_BUDGET_MS;
  const folders = await listAccountFolders(folderNames, deadline);
  if (!folders.length) {
    logger.warn("Aucun dossier trouve pour", folderNames);
    return attachFetchDiagnostics([], { requestedFolders: folderNames, folders, sinceDate });
  }

  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
  const candidateIds = new Set();
  const candidates = [];
  const collected = [];
  const toDate = new Date();

  for (const folder of folders) {
    ensureMailFetchBudget(deadline);

    let page = await withMailApiTimeout(
      messenger.messages.query({
        folderId: folder.id,
        fromDate: sinceDate,
        toDate,
        messagesPerPage: Math.min(Math.max(maxEmails, 10), 100),
      }),
      `La recherche dans ${folder.name}`,
      deadline
    );
    let pageCount = 0;

    while (page) {
      ensureMailFetchBudget(deadline);
      pageCount++;
      if (pageCount > MAX_MESSAGE_PAGES) {
        throw new Error(`La pagination du dossier ${folder.name} ne se termine pas.`);
      }

      for (const header of page.messages) {
        ensureMailFetchBudget(deadline);
        const recordId = stableMessageId(header, folder);
        if (exclude.has(recordId) || candidateIds.has(recordId)) continue;
        candidateIds.add(recordId);
        candidates.push({ folder, header, recordId });
      }

      if (!page.id || page.messages.length === 0) break;
      page = await withMailApiTimeout(
        messenger.messages.continueList(page.id),
        `La pagination du dossier ${folder.name}`,
        deadline
      );
    }
  }

  // L'ordre des resultats n'est pas garanti sur les versions de Thunderbird
  // supportees. Trier apres avoir parcouru tous les dossiers evite qu'un ancien
  // message du premier dossier consomme la limite avant un mail recu ce matin.
  candidates.sort((left, right) => messageTimestamp(right.header) - messageTimestamp(left.header));

  for (const { folder, header, recordId } of candidates) {
    ensureMailFetchBudget(deadline);
    if (collected.length >= maxEmails) break;
    const full = await withMailApiTimeout(
      messenger.messages.getFull(header.id),
      `La lecture du mail ${header.subject || header.id}`,
      deadline
    ).catch((e) => {
      logger.warn("Impossible de lire le corps du mail", header.id, e);
      return null;
    });
    if (!full) continue;

    const bodyText = truncateText(extractBodyText(full), maxBodyChars);
    collected.push({
      id: recordId,
      messageId: String(header.id),
      headerMessageId: String(header.headerMessageId || "").trim(),
      author: header.author,
      subject: header.subject,
      date: new Date(header.date).toISOString(),
      folder: folder.path,
      bodyText,
    });
  }

  return attachFetchDiagnostics(collected, {
    requestedFolders: folderNames,
    folders,
    sinceDate,
    candidateCount: candidates.length,
  });
}

function messageTimestamp(header) {
  const timestamp = new Date(header.date).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function openMailSource(source) {
  if (!source || typeof source !== "object") {
    throw new Error("Reference du mail absente.");
  }
  const storedHeaderId = String(source.headerMessageId || "").trim();
  const stableId = String(source.id || "");
  const separator = stableId.indexOf(":");
  const recoveredHeaderId = separator >= 0 ? stableId.slice(separator + 1).trim() : "";
  const headerMessageId = storedHeaderId || recoveredHeaderId;
  let lastError = null;

  if (headerMessageId) {
    try {
      return await messenger.messageDisplay.open({ headerMessageId, location: "tab", active: true });
    } catch (error) {
      lastError = error;
    }
  }

  const messageId = Number(source.messageId);
  if (Number.isInteger(messageId)) {
    try {
      return await messenger.messageDisplay.open({ messageId, location: "tab", active: true });
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || "Ce mail n'existe plus dans Thunderbird.");
}

function extractBodyText(fullMessagePart) {
  const htmlPart = findPartByContentType(fullMessagePart, "text/html");
  if (htmlPart?.body) return htmlToText(htmlPart.body);

  const textPart = findPartByContentType(fullMessagePart, "text/plain");
  if (textPart?.body) return collapseWhitespace(textPart.body);

  return "";
}

function findPartByContentType(part, contentType) {
  if (!part) return null;
  if (part.contentType && part.contentType.startsWith(contentType)) return part;
  for (const sub of part.parts || []) {
    const found = findPartByContentType(sub, contentType);
    if (found) return found;
  }
  return null;
}
