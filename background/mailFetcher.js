// Recuperation des mails du jour via messenger.messages.query(), extraction du
// contenu texte, et troncature pour rester dans une fenetre de contexte raisonnable.

async function listAccountFolders(folderNames) {
  const accounts = await messenger.accounts.list();
  const folders = [];
  for (const account of accounts) {
    for (const folder of account.folders || []) {
      collectFolders(folder, folderNames, folders);
    }
  }
  return folders;
}

function collectFolders(folder, wantedNames, out) {
  if (wantedNames.includes(folder.name) || wantedNames.includes(folder.path)) {
    out.push(folder);
  }
  for (const sub of folder.subFolders || []) {
    collectFolders(sub, wantedNames, out);
  }
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function fetchTodaysEmails({ folderNames, maxEmails, maxBodyChars }) {
  return fetchEmails({ folderNames, maxEmails, maxBodyChars, sinceDate: startOfToday() });
}

// Version generique : fenetre de dates arbitraire, et possibilite d'exclure des
// ids deja traites (utilise par l'indexation du chat pour ne pas re-parcourir
// les mails deja embeddes).
async function fetchEmails({ folderNames, maxEmails, maxBodyChars, sinceDate, excludeIds }) {
  const folders = await listAccountFolders(folderNames);
  if (!folders.length) {
    logger.warn("Aucun dossier trouve pour", folderNames);
    return [];
  }

  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
  const collected = [];

  for (const folder of folders) {
    if (collected.length >= maxEmails) break;

    const page = await messenger.messages.query({
      folderId: folder.id,
      fromDate: sinceDate,
    });

    for (const header of page.messages) {
      if (collected.length >= maxEmails) break;
      if (exclude.has(String(header.id))) continue;

      const full = await messenger.messages.getFull(header.id).catch((e) => {
        logger.warn("Impossible de lire le corps du mail", header.id, e);
        return null;
      });
      if (!full) continue;

      const bodyText = truncateText(extractBodyText(full), maxBodyChars);

      collected.push({
        id: String(header.id),
        author: header.author,
        subject: header.subject,
        date: new Date(header.date).toISOString(),
        folder: folder.path,
        bodyText,
      });
    }
  }

  return collected;
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
