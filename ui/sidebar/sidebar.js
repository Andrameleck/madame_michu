// Logique de la sidebar : affichage du resume, liste des RDV detectes,
// et flux de validation manuelle avant creation dans le calendrier.

const statusBar = document.getElementById("statusBar");
const summaryMeta = document.getElementById("summaryMeta");
const summaryContent = document.getElementById("summaryContent");
const eventsList = document.getElementById("eventsList");
const eventsEmpty = document.getElementById("eventsEmpty");
const regenerateBtn = document.getElementById("regenerateBtn");
const optionsBtn = document.getElementById("optionsBtn");

function setStatus(kind, message) {
  if (!message) {
    statusBar.hidden = true;
    return;
  }
  statusBar.hidden = false;
  statusBar.className = `status ${kind}`;
  statusBar.textContent = message;
}

// Rendu Markdown minimal (titres, gras, italique, listes, paragraphes) --
// suffisant pour le resume genere par le LLM, sans dependance externe.
function renderMarkdown(md) {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split("\n");
  let html = "";
  let inList = false;

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    const listItem = line.match(/^[-*]\s+(.*)/);

    if (heading) {
      if (inList) { html += "</ul>"; inList = false; }
      const level = heading[1].length;
      html += `<h${level}>${inlineMd(heading[2])}</h${level}>`;
      continue;
    }

    if (listItem) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inlineMd(listItem[1])}</li>`;
      continue;
    }

    if (inList) { html += "</ul>"; inList = false; }

    if (line.trim() === "") continue;
    html += `<p>${inlineMd(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

function inlineMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function formatEventWhen(evt) {
  const time = evt.startTime ? ` ${evt.startTime}${evt.endTime ? "-" + evt.endTime : ""}` : "";
  return `${evt.date}${time}${evt.location ? " · " + evt.location : ""}`;
}

function renderSummary(result) {
  if (!result) {
    summaryMeta.textContent = "";
    summaryContent.innerHTML = '<p class="empty">Aucun resume genere pour l\'instant.</p>';
    eventsList.innerHTML = "";
    eventsEmpty.hidden = false;
    return;
  }

  const generated = new Date(result.generatedAt).toLocaleString();
  summaryMeta.textContent = `Genere le ${generated} · ${result.emailCount} mail(s) analyses${result.dryRun ? " · DRY-RUN" : ""}`;
  summaryContent.innerHTML = renderMarkdown(result.summaryHtml || "");

  renderEvents(result.events || []);
}

function renderEvents(events) {
  eventsList.innerHTML = "";
  eventsEmpty.hidden = events.length > 0;

  for (const evt of events) {
    const li = document.createElement("li");
    li.className = "event-card";
    li.innerHTML = `
      <div class="event-title">${escapeHtml(evt.title)}
        <span class="confidence-badge confidence-${evt.confidence}">${evt.confidence}</span>
      </div>
      <div class="event-when">${escapeHtml(formatEventWhen(evt))}</div>
      <div class="event-desc">${escapeHtml(evt.description || "")}</div>
      <div class="event-actions">
        <button type="button" class="add-btn">Ajouter au calendrier</button>
        <button type="button" class="ignore-btn">Ignorer</button>
      </div>
    `;

    li.querySelector(".add-btn").addEventListener("click", () => handleAddEvent(evt, li));
    li.querySelector(".ignore-btn").addEventListener("click", () => handleIgnoreEvent(li));

    eventsList.appendChild(li);
  }
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markHandled(li, label, cls) {
  li.classList.add("handled");
  const actions = li.querySelector(".event-actions");
  actions.innerHTML = `<span class="handled-label ${cls}">${label}</span>`;
}

async function handleAddEvent(evt, li) {
  setStatus("loading", "Creation du rendez-vous dans le calendrier...");
  try {
    const result = await messenger.runtime.sendMessage({
      type: "CREATE_CALENDAR_EVENT",
      event: evt,
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

async function loadLastSummary() {
  const result = await messenger.runtime.sendMessage({ type: "GET_LAST_SUMMARY" });
  renderSummary(result);
}

async function regenerate() {
  regenerateBtn.disabled = true;
  setStatus("loading", "Generation du resume en cours...");
  try {
    const result = await messenger.runtime.sendMessage({ type: "REGENERATE_SUMMARY" });
    renderSummary(result);
    setStatus(null);
  } catch (e) {
    setStatus("error", e.message || "Erreur lors de la generation du resume.");
  } finally {
    regenerateBtn.disabled = false;
  }
}

regenerateBtn.addEventListener("click", regenerate);
optionsBtn.addEventListener("click", () => messenger.runtime.openOptionsPage());

// --- Navigation par onglets (Resume / Chat) ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = true));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).hidden = false;
  });
});

loadLastSummary();
