// Point d'entree du background script : orchestre recuperation des mails,
// appel LLM, sauvegarde du resultat, et reaction aux evenements (alarme, action).

const SUMMARY_RANGE_CONFIG = {
  day: { label: "aujourd'hui et la veille", emailMultiplier: 1.5 },
  week: { label: "la semaine en cours", emailMultiplier: 1.5 },
  month: { label: "le mois en cours", emailMultiplier: 2 },
};
const summaryGenerationInFlight = new Map();
const SUMMARY_GENERATION_PORT = "madame-michu-summary-generation";
const SUMMARY_CONTENT_FILTER_VERSION = 6;

function normalizeSummaryRange(range) {
  return Object.hasOwn(SUMMARY_RANGE_CONFIG, range) ? range : "day";
}

function hasNewSummaryEmails(emails, previousSummary) {
  if (!previousSummary || !Array.isArray(previousSummary.sourceMessages)) return true;
  const previousIds = new Set(previousSummary.sourceMessages.map((source) => source?.id).filter(Boolean));
  return emails.some((email) => email?.id && !previousIds.has(email.id));
}

function calendarFingerprint(events) {
  return JSON.stringify(events.map((event) => [
    event.sourceId,
    event.calendarName,
    event.title,
    event.startDate,
    event.endDate,
    event.location,
    event.allDay,
    event.description,
  ]));
}

async function performSummaryGeneration({ notify = true, range = "day", force = false } = {}) {
  range = normalizeSummaryRange(range);
  const rangeConfig = SUMMARY_RANGE_CONFIG[range];
  const settings = await getSettings();

  logger.info("Debut generation du resume", {
    range,
    providers: getEnabledProviderProfiles(settings).map((profile) => profile.name || profile.type),
    dryRun: settings.dryRun,
  });

  const maxEmails = Math.min(120, Math.ceil(settings.maxEmailsPerRun * rangeConfig.emailMultiplier));
  const [emails, calendarEvents] = await Promise.all([
    fetchSummaryEmails({
      range,
      folderNames: settings.scanAllFolders ? ["*"] : settings.scanFolders,
      maxEmails,
      maxBodyChars: settings.maxBodyChars,
    }),
    getSummaryCalendarEvents(range).catch((error) => {
      logger.warn("Lecture de l'agenda impossible pendant le rapport", error);
      return [];
    }),
  ]);
  const currentCalendarFingerprint = calendarFingerprint(calendarEvents);
  const externalBrief = range === "day"
    ? await fetchExternalBrief(settings, emails).catch((error) => {
      logger.warn("Bulletin exterieur indisponible", error);
      return null;
    })
    : null;
  const currentExternalFingerprint = externalBriefFingerprint(externalBrief);

  if (!force) {
    const previousSummary = await getLastSummary(range);
    if (
      previousSummary?.contentFilterVersion === SUMMARY_CONTENT_FILTER_VERSION &&
      !hasNewSummaryEmails(emails, previousSummary) &&
      previousSummary.calendarFingerprint === currentCalendarFingerprint
      && previousSummary.externalBriefFingerprint === currentExternalFingerprint
      && previousSummary.language === settings.uiLanguage
    ) {
      logger.info("Rapport conserve : aucun nouveau mail", { range, emailCount: emails.length });
      return { ...previousSummary, skipped: true, skipReason: "no-new-mail" };
    }
  }

  if (!emails.length && !calendarEvents.length && !externalBrief) {
    const matchedFolders = emails.diagnostics?.matchedFolders || [];
    const emptyMessage = matchedFolders.length
      ? `Aucun mail recu pour ${rangeConfig.label} dans ${matchedFolders.length} dossier(s) analyse(s).`
      : settings.scanAllFolders
        ? "Aucun dossier de courrier analysable n'a ete trouve."
        : `Aucun dossier ne correspond a : ${(settings.scanFolders || []).join(", ")}.`;
    const result = {
      generatedAt: new Date().toISOString(),
      range,
      summaryHtml: emptyMessage,
      sourceMessages: [],
      events: [],
      emailCount: 0,
      scanDiagnostics: emails.diagnostics,
      contentFilterVersion: SUMMARY_CONTENT_FILTER_VERSION,
      calendarEvents: [],
      calendarFingerprint: currentCalendarFingerprint,
      externalBrief: null,
      externalBriefFingerprint: currentExternalFingerprint,
      language: settings.uiLanguage,
    };
    await saveLastSummary(result, range);
    if (notify) await notifyUser("Madame Michu", emptyMessage);
    return result;
  }

  if (settings.dryRun) {
    const result = {
      generatedAt: new Date().toISOString(),
      range,
      summaryHtml: `**Mode dry-run** : ${emails.length} mail(s) et ${calendarEvents.length} evenement(s) calendrier auraient ete envoyes au LLM (aucun appel reel effectue).`,
      sourceMessages: emails.map(({ id, messageId, headerMessageId, subject }) => ({
        id,
        messageId,
        headerMessageId,
        subject,
      })),
      events: [],
      emailCount: emails.length,
      dryRun: true,
      scanDiagnostics: emails.diagnostics,
      contentFilterVersion: SUMMARY_CONTENT_FILTER_VERSION,
      calendarEvents,
      calendarFingerprint: currentCalendarFingerprint,
      externalBrief,
      externalBriefFingerprint: currentExternalFingerprint,
      language: settings.uiLanguage,
    };
    await saveLastSummary(result, range);
    return result;
  }

  const { system, user } = buildPrompt(emails, {
    rangeLabel: rangeConfig.label,
    rangeStart: emails.diagnostics?.sinceDate,
    rangeEnd: new Date().toISOString(),
    calendarEvents,
    externalBrief,
    language: settings.uiLanguage,
  });

  let raw;
  try {
    raw = await callProviderSummary(settings, system, user);
  } catch (e) {
    logger.error("Echec appel LLM", e);
    if (notify) await notifyUser("Madame Michu - Erreur", e.message);
    throw e;
  }

  let parsed;
  try {
    parsed = parseLlmResponse(raw);
  } catch (e) {
    logger.error("Echec parsing reponse LLM", e);
    if (notify) await notifyUser("Madame Michu - Erreur", e.message);
    throw e;
  }

  const sourceIds = new Set(emails.map((email) => email.id));
  let filteredEvents = filterByConfidence(parsed.events, settings.minConfidence).filter(
    (event) => event.sourceEmailId && sourceIds.has(event.sourceEmailId)
  );
  if (settings.autoCreateEvents && filteredEvents.length) {
    try {
      filteredEvents = await syncDetectedEventsToCalendar(filteredEvents, {
        calendarId: settings.defaultCalendarId,
        preferredName: "INRAE",
      });
    } catch (error) {
      logger.warn("Ajout automatique des rendez-vous indisponible", error);
      filteredEvents = filteredEvents.map((event) => ({
        ...event,
        calendarError: error.message || "Ajout automatique impossible",
      }));
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    range,
    summaryHtml: parsed.summary,
    summarySections: parsed.summarySections,
    sourceMessages: emails.map(({ id, messageId, headerMessageId, subject }) => ({
      id,
      messageId,
      headerMessageId,
      subject,
    })),
    events: filteredEvents,
    emailCount: emails.length,
    scanDiagnostics: emails.diagnostics,
    reachedEmailLimit: emails.length >= maxEmails,
    contentFilterVersion: SUMMARY_CONTENT_FILTER_VERSION,
    calendarEvents,
    calendarFingerprint: currentCalendarFingerprint,
    externalBrief,
    externalBriefFingerprint: currentExternalFingerprint,
    language: settings.uiLanguage,
  };

  await saveLastSummary(result, range);

  if (notify) {
    await notifyUser(
      "Madame Michu",
      `Rapport pret : ${emails.length} mail(s) analyses, ${filteredEvents.length} RDV detecte(s).`
    );
  }

  return result;
}

function runSummaryGeneration(options = {}) {
  const range = normalizeSummaryRange(options.range);
  if (summaryGenerationInFlight.has(range)) return summaryGenerationInFlight.get(range);
  const promise = performSummaryGeneration({ ...options, range }).finally(() => {
    summaryGenerationInFlight.delete(range);
  });
  summaryGenerationInFlight.set(range, promise);
  return promise;
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
      iconUrl: "icons/madame-michu-48.png",
      title,
      message,
    });
  } catch (e) {
    logger.warn("Impossible de creer la notification", e);
  }
}

// --- Listeners ---

messenger.runtime.onInstalled.addListener(async () => {
  await scheduleSummaryAlarms();
  const { remoteDataConsentAccepted } = await messenger.storage.local.get({
    remoteDataConsentAccepted: false,
  });
  if (!remoteDataConsentAccepted) await messenger.runtime.openOptionsPage?.();
});

messenger.runtime.onStartup.addListener(() => {
  scheduleSummaryAlarms();
});

// Une generation LLM peut durer plusieurs minutes. Un port explicite maintient
// le contexte MV3 et son canal de reponse actifs, la ou un sendMessage long peut
// etre ferme par Thunderbird avant que le provider ait termine.
messenger.runtime.onConnect.addListener((port) => {
  if (port.name !== SUMMARY_GENERATION_PORT) return;
  let disconnected = false;
  port.onDisconnect.addListener(() => { disconnected = true; });
  port.onMessage.addListener((message) => {
    if (message?.type === "KEEPALIVE") {
      if (!disconnected) port.postMessage({ type: "KEEPALIVE_ACK" });
      return;
    }
    if (message?.type !== "REGENERATE_SUMMARY") return;
    runSummaryGeneration({
      notify: false,
      range: message.range,
      force: message.force === true,
    }).then((result) => {
      if (!disconnected) port.postMessage({ ok: true, result });
    }).catch((error) => {
      logger.error("Generation demandee par la sidebar echouee", error);
      if (!disconnected) {
        port.postMessage({
          ok: false,
          error: { message: error?.message || "La generation du rapport a echoue." },
        });
      }
    });
  });
});

onSummaryAlarm(({ notify, kind }) => {
  runSummaryGeneration({ notify, range: "day", force: false }).catch((e) =>
    logger.error(`Generation automatique (${kind}) echouee`, e)
  );
});

messenger.action.onClicked.addListener(() => {
  messenger.tabs.create({ url: "ui/sidebar/sidebar.html" });
});

messenger.tabs.onUpdated.addListener((tabId, changeInfo) => {
  handleOpenAiCodexTabUpdate(tabId, changeInfo).catch((error) =>
    logger.warn("Interception du callback Codex impossible", error)
  );
});

// Messages venant de la sidebar / options (regenerer, creer un RDV, etc.)
messenger.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case "REGENERATE_SUMMARY":
      return runSummaryGeneration({ notify: false, range: message.range, force: message.force === true });

    case "CREATE_CALENDAR_EVENT":
      return createEventFromDetection(message.event, { calendarId: message.calendarId });

    case "OPEN_SOURCE_MESSAGE":
      return openMailSource(message.source);

    case "LIST_CALENDARS":
      return listCalendars();

    case "GET_LAST_SUMMARY":
      return getLastSummary(normalizeSummaryRange(message.range));

    case "RESCHEDULE_ALARM":
      return scheduleSummaryAlarms();

    case "CHAT_QUERY":
      return answerMailboxQuestion(message.question, {
        history: message.history,
        scope: message.scope,
      });

    case "ENSURE_MAIL_INDEX":
      return getSettings().then((settings) => refreshChatIndexIfStale(settings));

    case "INDEX_MAILBOX":
      return indexMailbox();

    case "GET_INDEX_STATUS":
      return getIndexStatus();

    case "TEST_PROVIDER_CONNECTION":
      return testProviderConnection(message.settings || {});

    case "LIST_PROVIDER_MODELS":
      return listProviderModels(message.settings || {});

    case "START_OPENAI_CODEX_AUTH":
      return startOpenAiCodexAuthorization(message.profileId);

    case "COMPLETE_OPENAI_CODEX_AUTH":
      return completeOpenAiCodexAuthorization(message.profileId, message.callbackUrl);

    case "GET_OPENAI_CODEX_AUTH_STATUS":
      return getOpenAiCodexAuthStatus(message.profileId);

    case "LOGOUT_OPENAI_CODEX":
      return deleteOpenAiCodexCredentials(message.profileId).then(() => ({ status: "disconnected" }));

    case "CLEAR_MAIL_INDEX":
      return clearMailboxIndex();

    default:
      return undefined;
  }
});
