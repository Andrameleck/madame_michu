// Point d'entree du background script : orchestre recuperation des mails,
// appel LLM, sauvegarde du resultat, et reaction aux evenements (alarme, action).

async function runSummaryGeneration({ notify = true } = {}) {
  const settings = await getSettings();

  logger.info("Debut generation du resume quotidien", {
    provider: settings.llmProvider,
    dryRun: settings.dryRun,
  });

  const emails = await fetchTodaysEmails({
    folderNames: settings.scanFolders,
    maxEmails: settings.maxEmailsPerRun,
    maxBodyChars: settings.maxBodyChars,
  });

  if (!emails.length) {
    const result = {
      generatedAt: new Date().toISOString(),
      summaryHtml: "Aucun nouveau mail aujourd'hui.",
      events: [],
      emailCount: 0,
    };
    await saveLastSummary(result);
    if (notify) await notifyUser("Assistant Mail IA", "Aucun nouveau mail aujourd'hui.");
    return result;
  }

  if (settings.dryRun) {
    const result = {
      generatedAt: new Date().toISOString(),
      summaryHtml: `**Mode dry-run** : ${emails.length} mail(s) auraient ete envoyes au LLM (aucun appel reel effectue).`,
      events: [],
      emailCount: emails.length,
      dryRun: true,
    };
    await saveLastSummary(result);
    return result;
  }

  const { system, user } = buildPrompt(emails);

  let raw;
  try {
    raw = await callOllama({
      baseUrl: settings.ollamaBaseUrl,
      model: settings.ollamaModel,
      system,
      user,
    });
  } catch (e) {
    logger.error("Echec appel LLM", e);
    if (notify) await notifyUser("Assistant Mail IA - Erreur", e.message);
    throw e;
  }

  let parsed;
  try {
    parsed = parseLlmResponse(raw);
  } catch (e) {
    logger.error("Echec parsing reponse LLM", e, raw);
    if (notify) await notifyUser("Assistant Mail IA - Erreur", e.message);
    throw e;
  }

  const filteredEvents = filterByConfidence(parsed.events, settings.minConfidence);

  const result = {
    generatedAt: new Date().toISOString(),
    summaryHtml: parsed.summary,
    events: filteredEvents,
    emailCount: emails.length,
  };

  await saveLastSummary(result);

  if (notify) {
    await notifyUser(
      "Assistant Mail IA",
      `Resume pret : ${emails.length} mail(s) analyses, ${filteredEvents.length} RDV detecte(s).`
    );
  }

  return result;
}

const CONFIDENCE_RANK = { basse: 0, moyenne: 1, haute: 2 };

function filterByConfidence(events, minConfidence) {
  const threshold = CONFIDENCE_RANK[minConfidence] ?? 1;
  return events.filter((ev) => (CONFIDENCE_RANK[ev.confidence] ?? 0) >= threshold);
}

async function notifyUser(title, message) {
  try {
    await messenger.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-48.svg",
      title,
      message,
    });
  } catch (e) {
    logger.warn("Impossible de creer la notification", e);
  }
}

// --- Listeners ---

messenger.runtime.onInstalled.addListener(() => {
  scheduleDailySummary();
});

messenger.runtime.onStartup.addListener(() => {
  scheduleDailySummary();
});

onDailyAlarm(() => {
  runSummaryGeneration({ notify: true }).catch((e) => logger.error("Generation auto echouee", e));
});

messenger.action.onClicked.addListener(() => {
  messenger.tabs.create({ url: "ui/sidebar/sidebar.html" });
});

// Messages venant de la sidebar / options (regenerer, creer un RDV, etc.)
messenger.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case "REGENERATE_SUMMARY":
      return runSummaryGeneration({ notify: false });

    case "CREATE_CALENDAR_EVENT":
      return createEventFromDetection(message.event, { calendarId: message.calendarId });

    case "LIST_CALENDARS":
      return listCalendars();

    case "GET_LAST_SUMMARY":
      return getLastSummary();

    case "RESCHEDULE_ALARM":
      return scheduleDailySummary();

    case "CHAT_QUERY":
      return answerMailboxQuestion(message.question, { history: message.history });

    case "INDEX_MAILBOX":
      return indexMailbox();

    case "GET_INDEX_STATUS":
      return getIndexStatus();

    default:
      return undefined;
  }
});
