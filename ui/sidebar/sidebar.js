// Logique de la sidebar : affichage du resume, liste des RDV detectes,
// et flux de validation manuelle avant creation dans le calendrier.

const statusBar = document.getElementById("statusBar");
const summaryMeta = document.getElementById("summaryMeta");
const summaryContent = document.getElementById("summaryContent");
const eventsList = document.getElementById("eventsList");
const eventsEmpty = document.getElementById("eventsEmpty");
const regenerateBtn = document.getElementById("regenerateBtn");
const optionsBtn = document.getElementById("optionsBtn");
const languageFrBtn = document.getElementById("languageFrBtn");
const languageEnBtn = document.getElementById("languageEnBtn");
const calendarSelect = document.getElementById("calendarSelect");
const summaryTitle = document.getElementById("summaryTitle");
const summaryRangeButtons = [...document.querySelectorAll(".summary-range-tab")];
regenerateBtn.disabled = false;

let uiLanguage = "fr";
const SIDEBAR_TEXT = {
  fr: {
    reportsEyebrow: "La paperasse utile", reports: "Rapports", regenerate: "Refaire ce rapport",
    day: "Jour", week: "Semaine", month: "Mois", events: "Rendez-vous detectes",
    calendar: "Calendrier cible", noEvents: "Aucun rendez-vous detecte dans les mails de cette periode.",
    chatEyebrow: "La loge est ouverte", chat: "Demande à Madame Michu", mood: "Blasee",
    chatEmpty: "Tu peux commencer par : « Quoi de neuf ? »",
    chatPlaceholder: "Demande un mail, une blague ou un petit ragot...", send: "Envoyer",
    options: "Options", report: "Rapport", generated: "Genere le", mails: "mail(s) analyses",
    folders: "dossier(s)", calendarEvents: "evenement(s) agenda", technical: "notification(s) technique(s) ignoree(s)",
    limit: "limite de mails atteinte", name: "Nom", action: "Action", need: "Besoin",
    sources: "sources",
  },
  en: {
    reportsEyebrow: "The useful paperwork", reports: "Reports", regenerate: "Regenerate this report",
    day: "Day", week: "Week", month: "Month", events: "Detected appointments",
    calendar: "Target calendar", noEvents: "No appointments detected in emails for this period.",
    chatEyebrow: "The lodge is open", chat: "Ask Madame Michu", mood: "Unimpressed",
    chatEmpty: "You could start with: “What's new?”",
    chatPlaceholder: "Ask about an email, request a joke, or fish for gossip...", send: "Send",
    options: "Options", report: "Report", generated: "Generated", mails: "email(s) analysed",
    folders: "folder(s)", calendarEvents: "calendar event(s)", technical: "technical notification(s) ignored",
    limit: "email limit reached", name: "Name", action: "Action", need: "Requirement",
    sources: "sources",
  },
};

function tr(key) {
  return SIDEBAR_TEXT[uiLanguage]?.[key] || SIDEBAR_TEXT.fr[key] || key;
}

function applySidebarLanguage() {
  document.documentElement.lang = uiLanguage === "en" ? "en-GB" : "fr";
  document.getElementById("reportsEyebrow").textContent = tr("reportsEyebrow");
  document.getElementById("reportsHeading").textContent = tr("reports");
  document.getElementById("eventsHeading").textContent = tr("events");
  document.getElementById("calendarLabel").textContent = tr("calendar");
  document.getElementById("chatEyebrow").textContent = tr("chatEyebrow");
  document.getElementById("chatHeading").textContent = tr("chat");
  eventsEmpty.textContent = tr("noEvents");
  regenerateBtn.textContent = tr("regenerate");
  optionsBtn.title = tr("options");
  optionsBtn.setAttribute("aria-label", tr("options"));
  summaryRangeButtons.forEach((button) => { button.textContent = tr(button.dataset.summaryRange); });
  const chatEmpty = document.querySelector("#chatMessages > .empty");
  if (chatEmpty) chatEmpty.textContent = tr("chatEmpty");
  const chatInputElement = document.getElementById("chatInput");
  if (chatInputElement) chatInputElement.placeholder = tr("chatPlaceholder");
  document.querySelector("#chatForm button").textContent = tr("send");
  languageFrBtn.classList.toggle("active", uiLanguage === "fr");
  languageEnBtn.classList.toggle("active", uiLanguage === "en");
  languageFrBtn.setAttribute("aria-pressed", String(uiLanguage === "fr"));
  languageEnBtn.setAttribute("aria-pressed", String(uiLanguage === "en"));
  if (summaryCache.has(activeSummaryRange)) renderSummary(summaryCache.get(activeSummaryRange));
}

const SUMMARY_RANGE_LABELS = {
  fr: { day: "jour", week: "semaine", month: "mois" },
  en: { day: "for today and yesterday", week: "for the week", month: "for the month" },
};
const SUMMARY_RANGE_TITLES = {
  fr: { day: "du jour et de la veille", week: "de la semaine", month: "du mois" },
  en: { day: "for today and yesterday", week: "for the week", month: "for the month" },
};
const SUMMARY_RANGE_EMPTY = {
  fr: { day: "aujourd'hui ni hier", week: "cette semaine", month: "ce mois" },
  en: { day: "today or yesterday", week: "this week", month: "this month" },
};
const SUMMARY_STORAGE_RANGES = {
  lastSummaryDay: "day",
  lastSummaryWeek: "week",
  lastSummaryMonth: "month",
};
const SUMMARY_GENERATION_PORT = "madame-michu-summary-generation";
const summaryCache = new Map();
let activeSummaryRange = "day";

function setStatus(kind, message) {
  if (!message) {
    statusBar.hidden = true;
    return;
  }
  statusBar.hidden = false;
  statusBar.className = `status ${kind}`;
  statusBar.textContent = message;
}

function createMailSourceButton(source) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mail-source-button";
  button.textContent = "✉";
  const subject = source.subject || (uiLanguage === "en" ? "No subject" : "Sans objet");
  button.title = uiLanguage === "en" ? `Open email: ${subject}` : `Ouvrir le mail : ${subject}`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await sendToBackground({ type: "OPEN_SOURCE_MESSAGE", source });
      setStatus(null);
    } catch (error) {
      setStatus("error", `Impossible d'ouvrir le mail : ${error.message}`);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

// Rendu Markdown minimal via des noeuds DOM. Le texte du LLM ne devient jamais
// du HTML executable, meme s'il essaie d'injecter des balises.
function appendInlineMarkdown(parent, text) {
  const parts = text.split(/(\*\*.+?\*\*|\*.+?\*)/g).filter(Boolean);
  for (const part of parts) {
    let element = null;
    let content = part;
    if (part.startsWith("**") && part.endsWith("**")) {
      element = document.createElement("strong");
      content = part.slice(2, -2);
    } else if (part.startsWith("*") && part.endsWith("*")) {
      element = document.createElement("em");
      content = part.slice(1, -1);
    }
    if (element) {
      element.textContent = content;
      parent.appendChild(element);
    } else {
      parent.appendChild(document.createTextNode(content));
    }
  }
}

function renderMarkdown(container, markdown) {
  container.replaceChildren();
  let list = null;

  for (const line of markdown.split("\n")) {
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    const listItem = line.match(/^[-*]\s+(.*)/);

    if (heading) {
      list = null;
      const node = document.createElement(`h${heading[1].length}`);
      appendInlineMarkdown(node, heading[2]);
      container.appendChild(node);
      continue;
    }

    if (listItem) {
      if (!list) {
        list = document.createElement("ul");
        container.appendChild(list);
      }
      const item = document.createElement("li");
      appendInlineMarkdown(item, listItem[1]);
      list.appendChild(item);
      continue;
    }

    list = null;
    if (line.trim() === "") continue;
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, line);
    container.appendChild(paragraph);
  }
}

const SUMMARY_CATEGORIES = [
  { key: "urgent", labels: { fr: "Urgent", en: "Urgent" } },
  { key: "important", labels: { fr: "Important", en: "Important" } },
  { key: "info", labels: { fr: "Info", en: "Information" } },
  { key: "other", labels: { fr: "Autre", en: "Other" } },
];
const MAX_INLINE_MAIL_SOURCES = 4;

function appendSummaryHighlights(parent, item) {
  if (!item || typeof item !== "object") return;
  const highlights = [
    [tr("name"), item.senderName],
    [tr("action"), item.action],
    [tr("need"), item.need],
  ].filter(([, value]) => typeof value === "string" && value.trim());
  if (!highlights.length) return;

  const list = document.createElement("dl");
  list.className = "summary-highlights";
  for (const [label, value] of highlights) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = `${label} :`;
    const description = document.createElement("dd");
    description.textContent = value;
    group.append(term, description);
    list.appendChild(group);
  }
  parent.appendChild(list);
}

function weatherStatLine(className, text) {
  const line = document.createElement("span");
  line.className = className;
  line.textContent = text;
  return line;
}

function renderWeatherCard(weather) {
  if (!weather?.current) return null;
  const card = document.createElement("div");
  card.className = "weather-card";

  const now = document.createElement("div");
  now.className = "weather-now";
  now.append(
    weatherStatLine("weather-icon-lg", weather.current.icon || "🌡️"),
    weatherStatLine(
      "weather-temp",
      Number.isFinite(weather.current.temperature) ? `${Math.round(weather.current.temperature)}°C` : "—"
    )
  );
  card.appendChild(now);

  if (weather.trend) {
    const trend = document.createElement("div");
    trend.className = "weather-trend";
    trend.append(
      weatherStatLine("weather-arrow", "→"),
      weatherStatLine("weather-icon-sm", weather.trend.icon || ""),
      weatherStatLine(
        "weather-trend-temp",
        Number.isFinite(weather.trend.temperature) ? `${Math.round(weather.trend.temperature)}°C` : ""
      )
    );
    card.appendChild(trend);
  }

  if (Number.isFinite(weather.current.pressure)) {
    card.appendChild(weatherStatLine("weather-pressure", `${Math.round(weather.current.pressure)} hPa`));
  }
  if (weather.location) {
    card.appendChild(weatherStatLine("weather-location", weather.location));
  }
  return card;
}

function renderSummaryOverviewBlock(overviewNode, externalOverview, weather) {
  const wrapper = document.createElement("div");
  wrapper.className = "summary-overview";
  const text = document.createElement("div");
  text.className = "summary-overview-text";
  text.appendChild(overviewNode);
  if (externalOverview) {
    const externalPara = document.createElement("p");
    externalPara.className = "summary-external";
    appendInlineMarkdown(externalPara, externalOverview);
    text.appendChild(externalPara);
  }
  wrapper.appendChild(text);
  const card = renderWeatherCard(weather);
  if (card) wrapper.appendChild(card);
  return wrapper;
}

function renderStructuredSummary(container, sections, sourceMessages = [], externalOverview = "", weather = null) {
  container.replaceChildren();
  const sourcesById = new Map(sourceMessages.map((source) => [source.id, source]));
  const overview = document.createElement("p");
  appendInlineMarkdown(overview, sections.overview || "Aucune synthese generale disponible.");
  container.appendChild(renderSummaryOverviewBlock(overview, externalOverview, weather));

  SUMMARY_CATEGORIES.forEach(({ key, labels }) => {
    const items = Array.isArray(sections[key]) ? sections[key] : [];
    if (!items.length) return;
    const category = document.createElement("section");
    category.className = `summary-category summary-category-${key}`;
    const heading = document.createElement("h3");
    heading.textContent = `${labels[uiLanguage]} (${items.length})`;
    category.appendChild(heading);

    const list = document.createElement("ul");
    for (const item of items) {
      const listItem = document.createElement("li");
      const text = typeof item === "string" ? item : item.text;
      appendSummaryHighlights(listItem, item);
      const detail = document.createElement("div");
      detail.className = "summary-item-detail";
      appendInlineMarkdown(detail, text || "");
      listItem.appendChild(detail);
      const sourceIds = typeof item === "object" && Array.isArray(item.sourceEmailIds)
        ? item.sourceEmailIds
        : [];
      const referencedSources = [...new Set(sourceIds)]
        .map((id) => sourcesById.get(id))
        .filter(Boolean);
      if (referencedSources.length) {
        const actions = document.createElement("span");
        actions.className = "mail-source-actions";
        for (const source of referencedSources.slice(0, MAX_INLINE_MAIL_SOURCES)) {
          actions.appendChild(createMailSourceButton(source));
        }
        if (referencedSources.length > MAX_INLINE_MAIL_SOURCES) {
          const overflow = document.createElement("details");
          overflow.className = "mail-source-overflow";
          const summary = document.createElement("summary");
          summary.textContent = `+${referencedSources.length - MAX_INLINE_MAIL_SOURCES} ${tr("sources")}`;
          const remaining = document.createElement("span");
          remaining.className = "mail-source-overflow-list";
          for (const source of referencedSources.slice(MAX_INLINE_MAIL_SOURCES)) {
            remaining.appendChild(createMailSourceButton(source));
          }
          overflow.append(summary, remaining);
          actions.appendChild(overflow);
        }
        listItem.appendChild(actions);
      }
      list.appendChild(listItem);
    }
    category.appendChild(list);
    container.appendChild(category);
  });
}

function formatEventWhen(evt) {
  const time = evt.startTime ? ` ${evt.startTime}${evt.endTime ? "-" + evt.endTime : ""}` : "";
  return `${evt.date}${time}${evt.location ? " · " + evt.location : ""}`;
}

function renderSummary(result) {
  summaryTitle.textContent = `${tr("report")} ${SUMMARY_RANGE_TITLES[uiLanguage][activeSummaryRange]}`;
  if (!result) {
    summaryMeta.textContent = "";
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = uiLanguage === "en"
      ? `Madame Michu has not prepared a report for ${SUMMARY_RANGE_EMPTY.en[activeSummaryRange]} yet.`
      : `Madame Michu n'a encore prepare aucun rapport pour ${SUMMARY_RANGE_EMPTY.fr[activeSummaryRange]}.`;
    summaryContent.replaceChildren(empty);
    eventsList.replaceChildren();
    eventsEmpty.hidden = false;
    return;
  }

  const generated = new Date(result.generatedAt).toLocaleString(uiLanguage === "en" ? "en-GB" : "fr-FR");
  const folderCount = result.scanDiagnostics?.matchedFolders?.length;
  const ignoredTechnicalCount = result.scanDiagnostics?.ignoredTechnicalCount || 0;
  const calendarEventCount = result.calendarEvents?.length || 0;
  summaryMeta.textContent = `${tr("generated")} ${generated} · ${result.emailCount} ${tr("mails")}${
    Number.isInteger(folderCount) ? ` · ${folderCount} ${tr("folders")}` : ""
  }${calendarEventCount ? ` · ${calendarEventCount} ${tr("calendarEvents")}` : ""
  }${ignoredTechnicalCount ? ` · ${ignoredTechnicalCount} ${tr("technical")}` : ""}${
    result.reachedEmailLimit ? ` · ${tr("limit")}` : ""}${
    result.dryRun ? " · DRY-RUN" : ""
  }`;
  if (result.summarySections) {
    renderStructuredSummary(
      summaryContent,
      result.summarySections,
      result.sourceMessages || [],
      result.externalOverview || "",
      result.externalBrief?.weather || null
    );
  } else {
    renderMarkdown(summaryContent, result.summaryHtml || "");
  }

  renderEvents(result.events || [], result.sourceMessages || []);
}

function renderEvents(events, sourceMessages = []) {
  eventsList.replaceChildren();
  eventsEmpty.hidden = events.length > 0;
  const sourcesById = new Map(sourceMessages.map((source) => [source.id, source]));

  for (const evt of events) {
    const li = document.createElement("li");
    li.className = "event-card";
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = evt.title;
    const badge = document.createElement("span");
    badge.className = `confidence-badge confidence-${evt.confidence}`;
    badge.textContent = evt.confidence;
    title.append(" ", badge);
    const source = sourcesById.get(evt.sourceEmailId);
    if (source) title.append(" ", createMailSourceButton(source));

    const when = document.createElement("div");
    when.className = "event-when";
    when.textContent = formatEventWhen(evt);
    const description = document.createElement("div");
    description.className = "event-desc";
    description.textContent = evt.description || "";

    const actions = document.createElement("div");
    actions.className = "event-actions";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "add-btn";
    addButton.textContent = "Ajouter au calendrier";
    const ignoreButton = document.createElement("button");
    ignoreButton.type = "button";
    ignoreButton.className = "ignore-btn";
    ignoreButton.textContent = "Ignorer";
    actions.append(addButton, ignoreButton);
    li.append(title, when, description, actions);

    addButton.addEventListener("click", () => handleAddEvent(evt, li));
    ignoreButton.addEventListener("click", () => handleIgnoreEvent(li));

    if (evt.calendarCreated) {
      markHandled(li, `Ajoute automatiquement a ${evt.calendarName}`, "created");
    } else if (evt.calendarDuplicate) {
      markHandled(li, `Deja present dans ${evt.calendarName}`, "ignored");
    } else if (evt.calendarSkipped) {
      markHandled(li, "Date passee, ajout automatique ignore", "ignored");
    } else if (evt.calendarError) {
      const error = document.createElement("div");
      error.className = "calendar-auto-error";
      error.textContent = `Ajout automatique impossible : ${evt.calendarError}`;
      actions.before(error);
    }

    eventsList.appendChild(li);
  }
}

function markHandled(li, label, cls) {
  li.classList.add("handled");
  const actions = li.querySelector(".event-actions");
  const status = document.createElement("span");
  status.className = `handled-label ${cls}`;
  status.textContent = label;
  actions.replaceChildren(status);
}

async function handleAddEvent(evt, li) {
  setStatus("loading", "Creation du rendez-vous dans le calendrier...");
  try {
    const result = await sendToBackground({
      type: "CREATE_CALENDAR_EVENT",
      event: evt,
      calendarId: calendarSelect.value || undefined,
    });
    if (result?.duplicate) {
      markHandled(li, "Deja present dans le calendrier", "ignored");
    } else {
      markHandled(li, "Ajoute au calendrier", "created");
    }
    setStatus(null);
  } catch (e) {
    setStatus("error", `Erreur creation RDV: ${e.message}`);
  }
}

function handleIgnoreEvent(li) {
  markHandled(li, "Ignore", "ignored");
}

async function loadLastSummary(range = activeSummaryRange) {
  const result = await sendToBackground({ type: "GET_LAST_SUMMARY", range });
  summaryCache.set(range, result);
  if (range === activeSummaryRange) renderSummary(result);
}

function activateSummaryRange(range, moveFocus = false) {
  if (!Object.hasOwn(SUMMARY_RANGE_LABELS.fr, range)) return;
  activeSummaryRange = range;
  summaryRangeButtons.forEach((button) => {
    const selected = button.dataset.summaryRange === range;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && moveFocus) button.focus();
  });
  if (summaryCache.has(range)) {
    renderSummary(summaryCache.get(range));
  } else {
    renderSummary(null);
    loadLastSummary(range).catch((error) => setStatus("error", error.message));
  }
}

async function loadCalendars() {
  try {
    const calendars = await sendToBackground({ type: "LIST_CALENDARS" });
    const writable = calendars.filter((calendar) => calendar.enabled && !calendar.readOnly);
    calendarSelect.replaceChildren();
    for (const calendar of writable) {
      const option = document.createElement("option");
      option.value = calendar.id;
      option.textContent = calendar.name;
      calendarSelect.appendChild(option);
    }
    const inraeCalendar = writable.find((calendar) =>
      calendar.name.toLocaleLowerCase().includes("inrae")
    );
    if (inraeCalendar) calendarSelect.value = inraeCalendar.id;
    calendarSelect.disabled = writable.length === 0;
    if (!writable.length) {
      const option = document.createElement("option");
      option.textContent = "Aucun calendrier modifiable";
      calendarSelect.appendChild(option);
    }
  } catch (error) {
    calendarSelect.disabled = true;
    const option = document.createElement("option");
    option.textContent = "Calendriers indisponibles";
    calendarSelect.replaceChildren(option);
    setStatus("error", error.message || "Impossible de lire les calendriers.");
  }
}

async function regenerate({ force = false } = {}) {
  if (regenerateBtn.disabled) return;
  const requestedRange = activeSummaryRange;
  const previousText = regenerateBtn.textContent;
  regenerateBtn.disabled = true;
  regenerateBtn.textContent = uiLanguage === "en" ? "Generating..." : "Generation en cours...";
  setStatus("loading", uiLanguage === "en"
    ? `Madame Michu is preparing the report ${SUMMARY_RANGE_LABELS.en[requestedRange]}...`
    : `Madame Michu prepare le rapport ${SUMMARY_RANGE_LABELS.fr[requestedRange]}...`);
  try {
    const result = await sendToBackgroundPort(
      { type: "REGENERATE_SUMMARY", range: requestedRange, force },
      {
        portName: SUMMARY_GENERATION_PORT,
        timeoutMs: 210_000,
        timeoutMessage: "L'operation prend trop de temps. Le bouton a ete reactive; verifie la connexion au serveur LLM puis reessaie.",
      }
    );
    summaryCache.set(requestedRange, result);
    if (requestedRange === activeSummaryRange) renderSummary(result);
    setStatus(null);
  } catch (e) {
    setStatus("error", e.message || "Erreur lors de la generation du resume.");
  } finally {
    regenerateBtn.disabled = false;
    regenerateBtn.textContent = previousText;
  }
}

regenerateBtn.addEventListener("click", () => regenerate({ force: true }));
optionsBtn.addEventListener("click", () => messenger.runtime.openOptionsPage());

async function switchLanguage(language) {
  if (!['fr', 'en'].includes(language) || language === uiLanguage) return;
  uiLanguage = language;
  await messenger.storage.local.set({ uiLanguage });
  summaryCache.clear();
  if (typeof chatHistory !== "undefined") chatHistory = [];
  applySidebarLanguage();
  await regenerate({ force: true });
}

languageFrBtn.addEventListener("click", () => switchLanguage("fr").catch((error) => setStatus("error", error.message)));
languageEnBtn.addEventListener("click", () => switchLanguage("en").catch((error) => setStatus("error", error.message)));

summaryRangeButtons.forEach((button, index) => {
  button.addEventListener("click", () => activateSummaryRange(button.dataset.summaryRange));
  button.addEventListener("keydown", (event) => {
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % summaryRangeButtons.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + summaryRangeButtons.length) % summaryRangeButtons.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = summaryRangeButtons.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    activateSummaryRange(summaryRangeButtons[nextIndex].dataset.summaryRange, true);
  });
});

async function initializeSidebar() {
  // Le premier message reveille et valide l'arriere-plan avant de lancer la
  // generation. Envoyer chargement, calendriers et rapport simultanement au
  // demarrage rendait le reveil de Thunderbird inutilement fragile.
  const languageSettings = await messenger.storage.local.get({ uiLanguage: "fr" });
  uiLanguage = languageSettings.uiLanguage === "en" ? "en" : "fr";
  applySidebarLanguage();
  await loadLastSummary();
  loadCalendars();
  await regenerate({ force: false });
}

initializeSidebar().catch((error) => setStatus("error", error.message));

messenger.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.uiLanguage) {
    uiLanguage = changes.uiLanguage.newValue === "en" ? "en" : "fr";
    applySidebarLanguage();
  }
  for (const [storageKey, range] of Object.entries(SUMMARY_STORAGE_RANGES)) {
    if (!changes[storageKey]) continue;
    summaryCache.set(range, changes[storageKey].newValue || null);
    if (range === activeSummaryRange) renderSummary(changes[storageKey].newValue || null);
  }
});
