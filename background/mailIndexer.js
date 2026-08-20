// Indexation incrementale des mails pour le chatbot : embedde chaque nouveau
// mail (non deja indexe) et le stocke dans le vector store local (IndexedDB).

async function indexMailbox() {
  const settings = await getSettings();

  const alreadyIndexed = await getAllVectorIds();

  const since = new Date();
  since.setDate(since.getDate() - settings.indexLookbackDays);

  const emails = await fetchEmails({
    folderNames: settings.indexFolders,
    maxEmails: settings.indexBatchSize,
    maxBodyChars: settings.indexBodyChars,
    sinceDate: since,
    excludeIds: alreadyIndexed,
  });

  let indexed = 0;
  let failed = 0;

  for (const mail of emails) {
    try {
      const embedding = await callOllamaEmbedding({
        baseUrl: settings.ollamaBaseUrl,
        model: settings.embeddingModel,
        text: `Objet: ${mail.subject}\nDe: ${mail.author}\nDate: ${mail.date}\n\n${mail.bodyText}`,
      });

      await upsertVector({
        id: mail.id,
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

  if (indexed > 0 || alreadyIndexed.size === 0) {
    await setLastIndexedAt(new Date().toISOString());
  }

  logger.info("Indexation terminee", { indexed, failed, totalInIndex, scanned: emails.length });

  return {
    indexed,
    failed,
    totalInIndex,
    scanned: emails.length,
    reachedBatchLimit: emails.length >= settings.indexBatchSize,
  };
}

async function getIndexStatus() {
  const settings = await getSettings();
  const totalInIndex = await countVectors();
  return { totalInIndex, lastIndexedAt: settings.lastIndexedAt };
}
