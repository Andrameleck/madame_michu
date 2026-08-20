// Logique de l'onglet Chat : indexation des mails et questions/reponses
// restreintes au contenu de la boite mail (RAG local via Ollama).

const indexStatusEl = document.getElementById("indexStatus");
const indexBtn = document.getElementById("indexBtn");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

let chatHistory = [];

function formatIndexStatus(status) {
  const count = status?.totalInIndex ?? 0;
  const last = status?.lastIndexedAt
    ? new Date(status.lastIndexedAt).toLocaleString()
    : "jamais";
  return `Index : ${count} mail(s) · derniere mise a jour : ${last}`;
}

async function refreshIndexStatus() {
  const status = await messenger.runtime.sendMessage({ type: "GET_INDEX_STATUS" });
  indexStatusEl.textContent = formatIndexStatus(status);
}

async function runIndexing() {
  indexBtn.disabled = true;
  const previousText = indexBtn.textContent;
  indexBtn.textContent = "Indexation en cours...";
  try {
    const result = await messenger.runtime.sendMessage({ type: "INDEX_MAILBOX" });
    await refreshIndexStatus();
    if (result.reachedBatchLimit) {
      indexStatusEl.textContent += " · limite de lot atteinte, relance l'indexation pour continuer";
    }
  } catch (e) {
    indexStatusEl.textContent = `Erreur d'indexation : ${e.message}`;
  } finally {
    indexBtn.disabled = false;
    indexBtn.textContent = previousText;
  }
}

function escapeChatHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appendMessage(role, text, sources) {
  const emptyMsg = chatMessages.querySelector(".empty");
  if (emptyMsg) emptyMsg.remove();

  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="text">${escapeChatHtml(text)}</div>`;

  if (sources && sources.length) {
    const sourcesHtml = sources
      .map(
        (s) =>
          `<li>${escapeChatHtml(s.subject)} — ${escapeChatHtml(s.author)} (${new Date(s.date).toLocaleDateString()})</li>`
      )
      .join("");
    div.innerHTML += `<div class="sources">Sources :<ul>${sourcesHtml}</ul></div>`;
  }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

async function sendQuestion(question) {
  appendMessage("user", question);
  chatInput.value = "";
  chatInput.disabled = true;

  const pending = appendMessage("assistant", "Recherche dans tes mails...");

  try {
    const { answer, sources } = await messenger.runtime.sendMessage({
      type: "CHAT_QUERY",
      question,
      history: chatHistory,
    });

    pending.querySelector(".text").textContent = answer;
    if (sources && sources.length) {
      const sourcesHtml = sources
        .map(
          (s) =>
            `<li>${escapeChatHtml(s.subject)} — ${escapeChatHtml(s.author)} (${new Date(s.date).toLocaleDateString()})</li>`
        )
        .join("");
      pending.innerHTML += `<div class="sources">Sources :<ul>${sourcesHtml}</ul></div>`;
    }

    chatHistory.push({ role: "user", content: question });
    chatHistory.push({ role: "assistant", content: answer });
    // On garde un historique court pour ne pas faire deriver le prompt.
    chatHistory = chatHistory.slice(-8);
  } catch (e) {
    pending.querySelector(".text").textContent = `Erreur : ${e.message}`;
  } finally {
    chatInput.disabled = false;
    chatInput.focus();
  }
}

chatForm.addEventListener("submit", (evt) => {
  evt.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;
  sendQuestion(question);
});

indexBtn.addEventListener("click", runIndexing);

refreshIndexStatus();
