// Indexation incrementale des mails pour le chatbot : embedde chaque nouveau
// mail (non deja indexe) et le stocke dans le vector store local (IndexedDB).

let indexingInFlight = null;
const INDEXING_BUDGET_MS = 90_000;

async function performMailboxIndexing() {
  const deadline = Date.now() + INDEXING_BUDGET_MS;
  const settings = await getSettings();
  const semanticMode = hasEmbeddingProvider(settings);

  const alreadyIndexed = await getAllVectorIds();

  const since = new Date();
  since.setDate(since.getDate() - settings.indexLookbackDays);

  const emails = await fetchEmails({
    folderNames: settings.indexAllFolders ? ["*"] : settings.indexFolders,
    maxEmails: settings.indexBatchSize,
    maxBodyChars: settings.indexBodyChars,
    sinceDate: since,
    excludeIds: alreadyIndexed,
  });

  let indexed = 0;
  let failed = 0;
  let stoppedEarly = false;

  for (const mail of emails) {
    if (Date.now() >= deadline) {
      stoppedEarly = true;
      break;
    }
    try {
      const embedding = semanticMode
        ? await callProviderEmbedding(
            settings,
            `Objet: ${mail.subject}\nDe: ${mail.author}\nDate: ${mail.date}\n\n${mail.bodyText}`
          )
        : null;

      await upsertVector({
        id: mail.id,
        messageId: mail.messageId,
        headerMessageId: mail.headerMessageId,
        subject: mail.subject,
        author: mail.author,
        date: mail.date,
        folder: mail.folder,
        excerpt: mail.bodyText,
        embedding,
      });
      indexed++;
    } catch (e) {
      logger.warn("Echec indexation mail", mail.id, e);
      failed++;
    }
  }

  const totalInIndex = await countVectors();

  const completedFullPass = !stoppedEarly && failed === 0 && emails.length < settings.indexBatchSize;
  if (completedFullPass || alreadyIndexed.size === 0) {
    await setLastIndexedAt(new Date().toISOString());
  }

  logger.info("Indexation terminee", { indexed, failed, totalInIndex, scanned: emails.length });

  return {
    indexed,
    failed,
    totalInIndex,
    scanned: emails.length,
    reachedBatchLimit: emails.length >= settings.indexBatchSize,
    stoppedEarly,
    mode: semanticMode ? "semantique" : "lexical",
    scanDiagnostics: emails.diagnostics,
  };
}

function indexMailbox() {
  if (indexingInFlight) return indexingInFlight;
  indexingInFlight = performMailboxIndexing().finally(() => {
    indexingInFlight = null;
  });
  return indexingInFlight;
}

async function getIndexStatus() {
  const settings = await getSettings();
  const totalInIndex = await countVectors();
  return {
    totalInIndex,
    lastIndexedAt: settings.lastIndexedAt,
    mode: hasEmbeddingProvider(settings) ? "semantique" : "lexical",
  };
}

async function clearMailboxIndex() {
  await clearVectors();
  await setLastIndexedAt(null);
  return { totalInIndex: 0, lastIndexedAt: null };
}
