// Logique de la sidebar : affichage du resume, liste des RDV detectes,
// et flux de validation manuelle avant creation dans le calendrier.

const statusBar = document.getElementById("statusBar");
const summaryMeta = document.getElementById("summaryMeta");
const summaryContent = document.getElementById("summaryContent");
const eventsList = document.getElementById("eventsList");
const eventsEmpty = document.getElementById("eventsEmpty");
const regenerateBtn = document.getElementById("regenerateBtn");
const optionsBtn = document.getElementById("optionsBtn");
const calendarSelect = document.getElementById("calendarSelect");
const summaryTitle = document.getElementById("summaryTitle");
const summaryRangeButtons = [...document.querySelectorAll(".summary-range-tab")];
regenerateBtn.disabled = false;

const SUMMARY_RANGE_LABELS = { day: "jour", week: "semaine", month: "mois" };
const SUMMARY_RANGE_TITLES = { day: "du jour et de la veille", week: "de la semaine", month: "du mois" };
const SUMMARY_RANGE_EMPTY = { day: "aujourd'hui ni hier", week: "cette semaine", month: "ce mois" };
const SUMMARY_STORAGE_RANGES = {
  lastSummaryDay: "day",
  lastSummaryWeek: "week",
  lastSummaryMonth: "month",
};
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
  const subject = source.subject || "Sans objet";
  button.title = `Ouvrir le mail : ${subject}`;
  button.setAttribute("aria-label", `Ouvrir le mail : ${subject}`);
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
  { key: "urgent", label: "Urgent" },
  { key: "important", label: "Important" },
  { key: "info", label: "Info" },
  { key: "other", label: "Autre" },
];

function appendSummaryHighlights(parent, item) {
  if (!item || typeof item !== "object") return;
  const highlights = [
    ["Nom", item.senderName],
    ["Action", item.action],
    ["Besoin", item.need],
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

function renderStructuredSummary(container, sections, sourceMessages = []) {
  container.replaceChildren();
  const sourcesById = new Map(sourceMessages.map((source) => [source.id, source]));
  const overview = document.createElement("p");
  overview.className = "summary-overview";
  appendInlineMarkdown(overview, sections.overview || "Aucune synthese generale disponible.");
  container.appendChild(overview);

  SUMMARY_CATEGORIES.forEach(({ key, label }) => {
    const items = Array.isArray(sections[key]) ? sections[key] : [];
    if (!items.length) return;
    const category = document.createElement("section");
    category.className = `summary-category summary-category-${key}`;
    const heading = document.createElement("h3");
    heading.textContent = `${label} (${items.length})`;
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
        for (const source of referencedSources) {
          actions.appendChild(createMailSourceButton(source));
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
  summaryTitle.textContent = `Rapport ${SUMMARY_RANGE_TITLES[activeSummaryRange]}`;
  if (!result) {
    summaryMeta.textContent = "";
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = `Madame Michu n'a encore prepare aucun rapport pour ${SUMMARY_RANGE_EMPTY[activeSummaryRange]}.`;
    summaryContent.replaceChildren(empty);
    eventsList.replaceChildren();
    eventsEmpty.hidden = false;
    return;
  }

  const generated = new Date(result.generatedAt).toLocaleString();
  const folderCount = result.scanDiagnostics?.matchedFolders?.length;
  summaryMeta.textContent = `Genere le ${generated} · ${result.emailCount} mail(s) analyses${
    Number.isInteger(folderCount) ? ` · ${folderCount} dossier(s)` : ""
  }${result.reachedEmailLimit ? " · limite de mails atteinte" : ""}${
    result.dryRun ? " · DRY-RUN" : ""
  }`;
  if (result.summarySections) {
    renderStructuredSummary(summaryContent, result.summarySections, result.sourceMessages || []);
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
  if (!Object.hasOwn(SUMMARY_RANGE_LABELS, range)) return;
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

async function regenerate() {
  if (regenerateBtn.disabled) return;
  const requestedRange = activeSummaryRange;
  const previousText = regenerateBtn.textContent;
  regenerateBtn.disabled = true;
  regenerateBtn.textContent = "Generation en cours...";
  setStatus("loading", `Madame Michu prepare le rapport ${SUMMARY_RANGE_LABELS[requestedRange]}...`);
  try {
    const result = await withUiTimeout(
      sendToBackground({ type: "REGENERATE_SUMMARY", range: requestedRange }),
      210_000,
      "L'operation prend trop de temps. Le bouton a ete reactive; verifie la connexion au serveur LLM puis reessaie."
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

regenerateBtn.addEventListener("click", regenerate);
optionsBtn.addEventListener("click", () => messenger.runtime.openOptionsPage());

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

loadLastSummary().catch((error) => setStatus("error", error.message));
loadCalendars();
// Ouvrir Madame Michu vaut demande de rapport : la generation demarre sans
// bloquer l'affichage de la derniere version connue.
regenerate().catch((error) => setStatus("error", error.message));

messenger.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  for (const [storageKey, range] of Object.entries(SUMMARY_STORAGE_RANGES)) {
    if (!changes[storageKey]) continue;
    summaryCache.set(range, changes[storageKey].newValue || null);
    if (range === activeSummaryRange) renderSummary(changes[storageKey].newValue || null);
  }
});
