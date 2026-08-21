// Indexation incrementale des mails pour le chatbot : embedde chaque nouveau
// mail (non deja indexe) et le stocke dans le vector store local (IndexedDB).

let indexingInFlight = null;
const INDEXING_BUDGET_MS = 90_000;
// Un embedding par mail, en serie, epuisait le budget de 90 s bien avant la fin
// d'un lot de 100. Les providers encaissent sans peine quelques appels paralleles.
const EMBEDDING_CONCURRENCY = 4;

async function performMailboxIndexing() {
  const deadline = Date.now() + INDEXING_BUDGET_MS;
  const settings = await getSettings();
  const configuredSemanticMode = hasEmbeddingProvider(settings);
  let semanticMode = configuredSemanticMode;
  let embeddingFallbackReason = "";

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

  let nextMail = 0;

  async function indexNextMails(limit = Infinity) {
    for (let handled = 0; handled < limit; handled++) {
      if (Date.now() >= deadline) {
        stoppedEarly = true;
        return;
      }
      const mail = emails[nextMail++];
      if (!mail) return;

      try {
        let embedding = null;
        if (semanticMode) {
          try {
            embedding = await callProviderEmbedding(
              settings,
              `Objet: ${mail.subject}\nDe: ${mail.author}\nDate: ${mail.date}\n\n${mail.bodyText}`
            );
          } catch (error) {
            semanticMode = false;
            embeddingFallbackReason = error.message || "Provider d'embedding indisponible";
            logger.warn("Embedding indisponible, poursuite de l'indexation en mode lexical", error);
          }
        }

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
  }

  // Premier mail traite seul : si le provider d'embedding est mort, on le
  // decouvre avant d'avoir lance trois appels supplementaires vers le vide.
  await indexNextMails(1);
  if (!stoppedEarly && nextMail < emails.length) {
    const workerCount = Math.max(1, Math.min(
      semanticMode ? EMBEDDING_CONCURRENCY : 1,
      emails.length - nextMail
    ));
    await Promise.all(Array.from({ length: workerCount }, () => indexNextMails()));
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
    mode: semanticMode
      ? "semantique"
      : configuredSemanticMode ? "lexical (secours)" : "lexical",
    embeddingFallbackReason,
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
