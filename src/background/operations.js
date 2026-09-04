// Surface publique du background : la table des operations que l'interface
// peut demander. Un seul endroit a lire pour savoir ce que l'extension sait
// faire, et une seule table a completer pour ajouter une capacite.

import { loadConfig, saveConfig, deleteSecret, pruneSecrets, setSecret, getSecret } from "../core/settings.js";
import { describeProviders } from "../llm/registry.js";
import { listModels, resetLearnedCapabilities, testProfile } from "../llm/gateway.js";
import {
  authorizationStatus,
  completeAuthorization,
  forgetFlow,
  startAuthorization,
} from "../llm/auth/chatgptOAuth.js";
import { listAccounts, listFolders } from "../mail/repository.js";
import {
  createEvent,
  findDuplicate,
  getEvents,
  listCalendars,
  isAvailable as calendarAvailable,
} from "../calendar/repository.js";
import { generateReport, getReport, getStoredReports } from "../features/reports/service.js";
import { ask } from "../features/chat/service.js";
import { deleteConversation, getConversation, listConversations } from "../features/chat/memory.js";
import { applyReportEvents, scanForEvents } from "../features/events/service.js";
import {
  approveWrite,
  clearResolvedWrites,
  listPendingWrites,
  rejectWrite,
} from "../features/pendingWrites.js";

export const operations = {
  // --- Configuration ---------------------------------------------------------
  "config.get": async () => ({
    config: await loadConfig({ refresh: true }),
    providers: describeProviders(),
    calendarAvailable: calendarAvailable(),
  }),

  "config.save": async ({ patch }) => {
    const config = await saveConfig(patch);
    // Un modele change peut ne pas avoir les memes capacites que le precedent.
    resetLearnedCapabilities();
    await pruneSecrets(config.llm.profiles.map((profile) => profile.id));
    return config;
  },

  // --- Profils LLM -----------------------------------------------------------
  "llm.setSecret": async ({ profileId, apiKey }) => {
    await setSecret(profileId, { apiKey });
    return { ok: true };
  },

  "llm.hasSecret": async ({ profileId }) => {
    const secret = await getSecret(profileId);
    return { apiKey: Boolean(secret.apiKey), oauth: Boolean(secret.oauth?.accessToken) };
  },

  "llm.forgetSecret": async ({ profileId }) => {
    await deleteSecret(profileId);
    forgetFlow(profileId);
    return { ok: true };
  },

  "llm.listModels": ({ profile }) => listModels(profile),

  "llm.test": ({ profile }) => testProfile(profile),

  // --- Connexion ChatGPT -----------------------------------------------------
  "chatgpt.connect": ({ profileId }) =>
    startAuthorization(profileId, { openTab: (url) => messenger.tabs.create({ url }) }),

  "chatgpt.complete": ({ profileId, callbackUrl }) =>
    completeAuthorization(profileId, callbackUrl, (credentials) =>
      setSecret(profileId, { oauth: credentials })
    ),

  "chatgpt.status": async ({ profileId }) => {
    const secret = await getSecret(profileId);
    return authorizationStatus(profileId, secret.oauth);
  },

  // --- Sources ---------------------------------------------------------------
  "mail.accounts": () => listAccounts(),
  "mail.folders": ({ accountId } = {}) => listFolders(accountId),
  "calendar.list": () => (calendarAvailable() ? listCalendars() : []),

  /** Alimente le widget « prochain rendez-vous » de la barre haute. */
  "calendar.upcoming": async ({ limit = 5, days = 365 } = {}) => {
    if (!calendarAvailable()) return [];
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + days);
    const events = await getEvents(now, until, { limit: limit * 4 });
    return events
      .filter((event) => Date.parse(event.endDate || event.startDate) >= now.getTime())
      .slice(0, limit);
  },

  // --- Rapports --------------------------------------------------------------
  "reports.all": () => getStoredReports(),
  "reports.get": ({ range }) => getReport(range),
  "reports.generate": ({ range, force }, context) =>
    generateReport(range, { force, signal: context?.signal }),

  // --- Chat ------------------------------------------------------------------
  "chat.ask": ({ conversationId, question }, context) =>
    ask({
      conversationId,
      question,
      signal: context?.signal,
      onStep: (step) => context?.emit({ kind: "tool", tool: step.tool, ok: step.ok }),
    }),

  "chat.conversations": () => listConversations(),
  "chat.conversation": ({ id }) => getConversation(id),
  "chat.delete": async ({ id }) => {
    await deleteConversation(id);
    return { ok: true };
  },

  // --- Evenements ------------------------------------------------------------
  "events.scan": ({ sinceDays }, context) => scanForEvents({ sinceDays, signal: context?.signal }),
  "events.fromReport": async ({ range }) => applyReportEvents(await getReport(range)),

  /** Inscription immediate : le clic de l'utilisateur vaut confirmation. */
  "events.create": async ({ event }) => {
    const config = await loadConfig();
    return createEvent(event, { calendarId: config.calendar.calendarId });
  },

  /** Detections deja presentes a l'agenda, pour ne pas proposer de les ajouter deux fois. */
  "events.duplicates": async ({ events } = {}) => {
    const config = await loadConfig();
    return Promise.all(
      (events || []).map(async (event) => Boolean(await findDuplicate(event, config.calendar.calendarId)))
    );
  },

  // --- Ecritures en attente --------------------------------------------------
  "writes.list": ({ status } = {}) => listPendingWrites({ status }),
  "writes.approve": async ({ id }) => {
    const config = await loadConfig();
    return approveWrite(id, { calendarId: config.calendar.calendarId });
  },
  "writes.reject": ({ id }) => rejectWrite(id),
  "writes.clear": () => clearResolvedWrites(),
};
