// Interface principale : rapports a gauche, discussion a droite.
//
// La sidebar ne lit jamais la messagerie elle-meme. Elle demande une operation
// au background et affiche un resultat deja nettoye. Les operations longues
// passent par le client persistant : sans lui, Thunderbird peut suspendre la
// page d'arriere-plan au milieu d'une generation.

import { call, createClient } from "../../core/messaging.js";
import { clear, el, replace } from "../shared/dom.js";
import { applyTranslations, getLanguage, setLanguage, t } from "../shared/i18n.js";
import { isWritable } from "../../calendar/repository.js";

const client = createClient();

const nodes = {
  status: document.getElementById("statusBar"),
  summaryTitle: document.getElementById("summaryTitle"),
  summaryMeta: document.getElementById("summaryMeta"),
  summaryContent: document.getElementById("summaryContent"),
  eventsList: document.getElementById("eventsList"),
  eventsEmpty: document.getElementById("eventsEmpty"),
  calendarSelect: document.getElementById("calendarSelect"),
  chatMessages: document.getElementById("chatMessages"),
  chatActivity: document.getElementById("chatActivity"),
  chatInput: document.getElementById("chatInput"),
  chatSend: document.getElementById("chatSendBtn"),
  portrait: document.getElementById("chatPortrait"),
  portraitMood: document.getElementById("chatPortraitMood"),
  nextEventTitle: document.getElementById("nextEventTitle"),
  nextEventWhen: document.getElementById("nextEventWhenText"),
  nextEventStatus: document.getElementById("nextEventStatus"),
};

const state = {
  range: "day",
  conversationId: crypto.randomUUID(),
  reports: {},
  events: [],       // { key, origin: "report"|"pending", id?, event, handled? }
  calendars: [],
  calendarAvailable: false,
  // Deux verrous distincts : un rapport en cours de generation ne doit pas
  // empecher de poser une question. Le background traite les deux demandes en
  // parallele, chacune sur son propre identifiant de requete.
  reportBusy: false,
  chatBusy: false,
};

const IMPORTANCE_ORDER = ["urgent", "important", "info", "autre"];

// -----------------------------------------------------------------------------
// Etat visible
// -----------------------------------------------------------------------------

let statusTimer = null;

function showStatus(message, tone = "info", { sticky = false } = {}) {
  clearTimeout(statusTimer);
  nodes.status.textContent = message;
  nodes.status.className = `status ${tone}`;
  nodes.status.hidden = false;
  if (!sticky) statusTimer = setTimeout(() => { nodes.status.hidden = true; }, 7000);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(getLanguage() === "en" ? "en-GB" : "fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return date.toLocaleDateString(getLanguage() === "en" ? "en-GB" : "fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// -----------------------------------------------------------------------------
// Langue
// -----------------------------------------------------------------------------

async function switchLanguage(language) {
  setLanguage(language);
  applyTranslations();
  markActiveLanguage();
  renderReport();
  renderEvents();
  fillCalendarSelect();
  loadNextEvent();
  // La langue vaut aussi pour les reponses du modele, pas seulement pour l'UI.
  await call("config.save", { patch: { language } }).catch(() => {});
}

function markActiveLanguage() {
  document.getElementById("languageFrBtn").classList.toggle("active", getLanguage() === "fr");
  document.getElementById("languageEnBtn").classList.toggle("active", getLanguage() === "en");
}

document.getElementById("languageFrBtn").addEventListener("click", () => switchLanguage("fr"));
document.getElementById("languageEnBtn").addEventListener("click", () => switchLanguage("en"));
document.getElementById("optionsBtn").addEventListener("click", () => messenger.runtime.openOptionsPage());

// -----------------------------------------------------------------------------
// Widget prochain rendez-vous
// -----------------------------------------------------------------------------

async function loadNextEvent() {
  if (!state.calendarAvailable) {
    nodes.nextEventTitle.textContent = t("events.unavailable");
    nodes.nextEventWhen.textContent = "";
    renderNextEventStatus(null);
    return;
  }
  try {
    const [next] = await call("calendar.upcoming", { limit: 1 });
    nodes.nextEventTitle.textContent = next?.title || t("topbar.nextEvent.none");
    nodes.nextEventWhen.textContent = next ? formatDateTime(next.startDate) : "";
    renderNextEventStatus(next);
  } catch {
    nodes.nextEventTitle.textContent = t("topbar.nextEvent.none");
    nodes.nextEventWhen.textContent = "";
    renderNextEventStatus(null);
  }
}

/** Jours calendaires entre aujourd'hui et une date, 0 pour aujourd'hui. */
function daysUntil(value) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(value);
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((startOfTarget - startOfToday) / 86400000);
}

/** « En cours » si la reunion a demarre et n'est pas finie, sinon un compte a rebours « J-N ». */
function renderNextEventStatus(event) {
  const start = Date.parse(event?.startDate);
  const end = Date.parse(event?.endDate || event?.startDate);
  if (!Number.isFinite(start)) {
    nodes.nextEventStatus.hidden = true;
    return;
  }

  const now = Date.now();
  if (now >= start && (!Number.isFinite(end) || now <= end)) {
    nodes.nextEventStatus.hidden = false;
    nodes.nextEventStatus.className = "next-event-status ongoing";
    nodes.nextEventStatus.textContent = t("topbar.nextEvent.ongoing");
    return;
  }

  if (start > now) {
    nodes.nextEventStatus.hidden = false;
    nodes.nextEventStatus.className = "next-event-status upcoming";
    nodes.nextEventStatus.textContent = `J-${Math.max(0, daysUntil(event.startDate))}`;
    return;
  }

  nodes.nextEventStatus.hidden = true;
}

// -----------------------------------------------------------------------------
// Rapports
// -----------------------------------------------------------------------------

for (const tab of document.querySelectorAll(".summary-range-tab")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".summary-range-tab")) {
      const active = other === tab;
      other.classList.toggle("active", active);
      other.setAttribute("aria-selected", String(active));
    }
    state.range = tab.dataset.range;
    renderReport();
    collectEvents();
    if (!state.reports[state.range]) generateReport(false);
  });
}

document.getElementById("regenerateBtn").addEventListener("click", () => generateReport(true));

function renderReport() {
  nodes.summaryTitle.textContent = t(`reports.title.${state.range}`);
  const report = state.reports[state.range];

  if (!report) {
    nodes.summaryMeta.textContent = "";
    replace(nodes.summaryContent, el("p", { class: "empty", text: t("reports.empty") }));
    return;
  }

  nodes.summaryMeta.textContent = [
    `${report.messageCount} ${t("reports.messages")}`,
    `${t("reports.generatedAt")} ${formatDateTime(report.generatedAt)}`,
    report.fromCache ? t("reports.unchanged") : "",
  ].filter(Boolean).join(" · ");

  const categories = IMPORTANCE_ORDER
    .map((level) => {
      const entries = report.entries.filter((entry) => entry.importance === level);
      return entries.length ? renderCategory(level, entries) : null;
    })
    .filter(Boolean);

  replace(nodes.summaryContent,
    report.overview
      ? el("div", { class: "summary-overview" },
          el("div", { class: "summary-overview-text" }, el("p", { text: report.overview })))
      : null,
    categories.length ? categories : el("p", { class: "empty", text: t("reports.nothing") })
  );
}

function renderCategory(level, entries) {
  return el("section", { class: `summary-category summary-category-${level}` },
    el("h3", { text: t(`importance.${level}`) }),
    el("ul", {}, entries.map(renderEntry))
  );
}

function renderEntry(entry) {
  const highlights = el("dl", { class: "summary-highlights" },
    entry.sender ? el("div", {}, el("dt", { text: "De" }), el("dd", { text: entry.sender })) : null,
    entry.deadline
      ? el("div", {},
          el("dt", { text: t("reports.deadline") }),
          el("dd", { class: "summary-item-deadline", text: entry.deadline }))
      : null
  );

  return el("li", {},
    highlights,
    el("p", { class: "summary-item-detail" },
      el("strong", { text: entry.subject }),
      renderSourceButtons(entry.messageIds)
    ),
    el("p", { class: "summary-item-detail", text: entry.summary }),
    entry.action ? el("p", { class: "summary-item-detail summary-item-action", text: `→ ${entry.action}` }) : null
  );
}

function renderSourceButtons(messageIds = []) {
  if (!messageIds.length) return null;
  return el("span", { class: "mail-source-actions" },
    messageIds.slice(0, 4).map((id) =>
      el("button", {
        type: "button",
        class: "mail-source-button",
        title: t("reports.openMail"),
        "aria-label": t("reports.openMail"),
        text: "✉",
        onclick: () => openMessage(id),
      })
    )
  );
}

async function openMessage(id) {
  try {
    const tabs = await messenger.mailTabs.query({ active: true, currentWindow: true });
    if (tabs.length) await messenger.mailTabs.setSelectedMessages(tabs[0].id, [Number(id)]);
    else await messenger.messageDisplay.open({ messageId: Number(id) });
  } catch {
    showStatus(t("reports.openMail") + " : ✕", "error");
  }
}

async function generateReport(force) {
  if (state.reportBusy) return;
  state.reportBusy = true;
  showStatus(t("reports.working"), "loading", { sticky: true });
  replace(nodes.summaryContent, el("p", { class: "empty", text: t("reports.working") }));

  const { promise } = client.request("reports.generate", { range: state.range, force });
  try {
    const report = await promise;
    state.reports[report.range] = report;
    nodes.status.hidden = true;
    renderReport();
    collectEvents();
  } catch (error) {
    nodes.status.hidden = true;
    replace(nodes.summaryContent,
      el("p", { class: "empty", text: error.message }),
      el("button", { type: "button", class: "secondary", text: t("reports.retry"), onclick: () => generateReport(true) })
    );
  } finally {
    state.reportBusy = false;
  }
}

// -----------------------------------------------------------------------------
// Rendez-vous detectes
// -----------------------------------------------------------------------------

function eventKey(event) {
  return `${(event.title || "").toLowerCase()}|${event.date}`;
}

/** Rassemble les detections du rapport et les propositions en attente. */
async function collectEvents() {
  const fromReport = (state.reports[state.range]?.events || []).map((event) => ({
    key: eventKey(event),
    origin: "report",
    event,
  }));

  let pending = [];
  try {
    pending = (await call("writes.list", { status: "pending" }))
      .filter((entry) => entry.type === "create_event")
      .map((entry) => ({ key: eventKey(entry.payload), origin: "pending", id: entry.id, event: entry.payload }));
  } catch {
    pending = [];
  }

  // Une proposition deja en attente prime sur la meme detection brute : valider
  // deux fois le meme rendez-vous n'aurait pas de sens.
  const seen = new Map();
  for (const item of [...pending, ...fromReport]) {
    if (!seen.has(item.key)) seen.set(item.key, item);
  }
  const previous = new Map(state.events.map((item) => [item.key, item.handled]));
  const merged = [...seen.values()].map((item) => ({ ...item, handled: previous.get(item.key) || null }));

  // Verifie a l'agenda, avant meme d'afficher les boutons, plutot que de
  // laisser l'utilisateur decouvrir le doublon apres avoir clique « Inscrire ».
  const toCheck = merged.filter((item) => !item.handled);
  if (toCheck.length && state.calendarAvailable) {
    try {
      const duplicates = await call("events.duplicates", { events: toCheck.map((item) => item.event) });
      toCheck.forEach((item, index) => {
        if (duplicates[index]) item.handled = "duplicate";
      });
    } catch {
      // Verification meilleur-effort : en cas d'echec on retombe sur le bouton Inscrire.
    }
  }

  state.events = merged;
  renderEvents();
}

function renderEvents() {
  const visible = state.events;
  nodes.eventsEmpty.hidden = visible.length > 0;
  replace(nodes.eventsList, visible.map(renderEventCard));
}

function renderEventCard(item) {
  const { event } = item;
  const when = [formatDay(event.date), event.startTime, event.location].filter(Boolean).join(" · ");

  return el("li", { class: `event-card${item.handled ? " handled" : ""}` },
    el("div", { class: "event-title" },
      event.title,
      event.confidence
        ? el("span", {
            class: `confidence-badge confidence-${event.confidence}`,
            text: t(`events.confidence.${event.confidence}`),
          })
        : null
    ),
    el("div", { class: "event-when", text: when }),
    event.description ? el("div", { class: "event-desc", text: event.description }) : null,
    item.handled
      ? el("span", {
          class: `handled-label ${item.handled === "ignored" ? "ignored" : "created"}`,
          text: t(item.handled === "ignored" ? "events.ignored"
            : item.handled === "duplicate" ? "events.duplicate" : "events.added"),
        })
      // Sans pont calendrier, proposer « Inscrire » ne mene qu'a un echec :
      // mieux vaut dire pourquoi tout de suite.
      : !state.calendarAvailable
        ? el("span", { class: "handled-label ignored", text: t("events.unavailable") })
        : el("div", { class: "event-actions" },
          el("button", { type: "button", class: "add-btn", text: t("events.add"), onclick: () => acceptEvent(item) }),
          el("button", { type: "button", class: "ignore-btn secondary", text: t("events.ignore"), onclick: () => dismissEvent(item) })
        )
  );
}

async function acceptEvent(item) {
  try {
    const result = item.origin === "pending"
      ? await call("writes.approve", { id: item.id })
      : await call("events.create", { event: item.event });
    const duplicate = result?.duplicate || result?.result?.duplicate;
    item.handled = duplicate ? "duplicate" : "created";
    renderEvents();
    loadNextEvent();
  } catch (error) {
    showStatus(error.message, "error");
  }
}

async function dismissEvent(item) {
  if (item.origin === "pending") await call("writes.reject", { id: item.id }).catch(() => {});
  item.handled = "ignored";
  renderEvents();
}

document.getElementById("scanEventsBtn").addEventListener("click", async (clickEvent) => {
  const button = clickEvent.target;
  button.disabled = true;
  button.textContent = t("events.scanning");
  const { promise } = client.request("events.scan", { sinceDays: 7 });
  try {
    const result = await promise;
    if (!result.available) showStatus(t("events.unavailable"), "error");
    await collectEvents();
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = t("events.scan");
  }
});

function fillCalendarSelect() {
  clear(nodes.calendarSelect);
  nodes.calendarSelect.append(el("option", { value: "", text: t("events.calendarDefault") }));
  for (const calendar of state.calendars) {
    // Un calendrier non modifiable reste visible mais inchoisissable : le
    // proposer ne menerait qu'a un refus de Lightning au moment d'ecrire.
    const suffix = calendar.enabled === false
      ? ` (${t("events.disabled")})`
      : calendar.readOnly === true ? ` (${t("events.readOnly")})` : "";
    nodes.calendarSelect.append(el("option", {
      value: calendar.id,
      text: calendar.name + suffix,
      disabled: !isWritable(calendar),
    }));
  }
  nodes.calendarSelect.value = state.calendarId || "";
}

nodes.calendarSelect.addEventListener("change", async (event) => {
  state.calendarId = event.target.value;
  await call("config.save", { patch: { calendar: { calendarId: state.calendarId } } }).catch(() => {});
});

// -----------------------------------------------------------------------------
// Discussion
// -----------------------------------------------------------------------------

function setPortrait(mood) {
  const known = ["default", "exasperee", "furieuse", "soupconneuse", "profil-meprisant",
    "inspection-penchee", "epuisee-affaissee"];
  const safe = known.includes(mood) ? mood : "default";
  const label = t(`mood.${safe}`);
  nodes.portrait.src = `portraits/${safe}.png`;
  nodes.portrait.alt = `Madame Michu, ${label}`;
  nodes.portraitMood.textContent = label;
  nodes.portraitMood.removeAttribute("data-i18n");
}

function appendMessage(role, text) {
  if (nodes.chatMessages.querySelector(".empty")) clear(nodes.chatMessages);
  const bubble = el("div", { class: `chat-msg ${role}` },
    el("div", { class: "text" }, ...String(text).split(/\n{2,}/).map((block) => el("p", { text: block })))
  );
  nodes.chatMessages.append(bubble);
  nodes.chatMessages.scrollTop = nodes.chatMessages.scrollHeight;
  return bubble;
}

function appendSources(bubble, sources) {
  if (!sources?.length) return;
  bubble.append(el("details", { class: "sources" },
    el("summary", { text: `${sources.length} ${t("chat.sources")}` }),
    el("ul", {}, sources.map((source) =>
      el("li", {},
        el("button", {
          type: "button",
          class: "link-button",
          text: `${source.author} — ${source.subject}`,
          onclick: () => openMessage(source.id),
        })
      )
    ))
  ));
  nodes.chatMessages.scrollTop = nodes.chatMessages.scrollHeight;
}

/**
 * Detail des outils appeles. Sans cette vue, une reponse fausse parce que le
 * modele a trop filtre sa recherche est indiagnostiquable.
 */
function appendSteps(bubble, steps) {
  if (!steps?.length) return;
  bubble.append(el("details", { class: "sources" },
    el("summary", { text: `${steps.length} ${t("chat.searches")}` }),
    el("ul", {}, steps.map((step) =>
      el("li", { text: `${t(`tool.${step.tool}`) || step.tool} — ${describeArguments(step.arguments)}` })
    ))
  ));
}

function describeArguments(args) {
  const entries = Object.entries(args || {}).filter(
    ([, value]) => value !== undefined && value !== "" && value !== false
  );
  if (!entries.length) return t("chat.noFilter");
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}

document.getElementById("chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  sendQuestion();
});

document.getElementById("newThreadBtn").addEventListener("click", () => {
  state.conversationId = crypto.randomUUID();
  replace(nodes.chatMessages, el("p", { class: "empty", text: t("chat.start") }));
  setPortrait("default");
  showStatus(t("chat.newThreadDone"), "info");
});

async function sendQuestion() {
  const question = nodes.chatInput.value.trim();
  if (!question) return;
  if (state.chatBusy) {
    // Un envoi refuse en silence donne l'impression d'une interface morte :
    // on le dit, et on conserve le texte saisi.
    showStatus(t("chat.busy"), "info");
    return;
  }
  state.chatBusy = true;
  nodes.chatSend.disabled = true;
  nodes.chatInput.value = "";
  appendMessage("user", question);

  nodes.chatActivity.hidden = false;
  nodes.chatActivity.textContent = t("chat.thinking");

  const { promise } = client.request(
    "chat.ask",
    { conversationId: state.conversationId, question },
    (event) => {
      if (event.kind === "tool") {
        nodes.chatActivity.textContent = `Madame Michu ${t(`tool.${event.tool}`)}…`;
      }
    }
  );

  try {
    const result = await promise;
    const bubble = appendMessage("assistant", result.answer || t("chat.noAnswer"));
    appendSources(bubble, result.sources);
    appendSteps(bubble, result.steps);
    setPortrait(result.mood);
    if (result.exhausted) showStatus(t("chat.exhausted"), "info");
  } catch (error) {
    appendMessage("assistant chat-error", error.message);
    setPortrait("furieuse");
  } finally {
    nodes.chatActivity.hidden = true;
    nodes.chatSend.disabled = false;
    state.chatBusy = false;
    nodes.chatInput.focus();
  }
}

// -----------------------------------------------------------------------------
// Demarrage
// -----------------------------------------------------------------------------

async function boot() {
  try {
    const snapshot = await call("config.get");
    setLanguage(snapshot.config.language);
    applyTranslations();
    markActiveLanguage();
    state.calendarAvailable = snapshot.calendarAvailable;
    state.calendarId = snapshot.config.calendar.calendarId;

    if (!snapshot.config.llm.profiles.length) {
      replace(nodes.summaryContent,
        el("p", { class: "empty", text: t("state.noProfile") }),
        el("button", {
          type: "button",
          text: t("state.openOptions"),
          onclick: () => messenger.runtime.openOptionsPage(),
        })
      );
      loadNextEvent();
      return;
    }

    state.calendars = snapshot.calendarAvailable ? await call("calendar.list").catch(() => []) : [];
    fillCalendarSelect();
    loadNextEvent();

    state.reports = await call("reports.all");
    renderReport();
    await collectEvents();
    if (!state.reports.day) generateReport(false);
  } catch (error) {
    showStatus(error.message, "error", { sticky: true });
  }
}

boot();
