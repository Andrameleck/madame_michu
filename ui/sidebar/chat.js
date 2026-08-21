// Logique de l'onglet Chat : recherche dans les mails ou conversation generale.

const indexStatusEl = document.getElementById("indexStatus");
const indexBtn = document.getElementById("indexBtn");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatScope = document.getElementById("chatScope");
indexBtn.disabled = false;

let chatHistory = [];

function formatIndexStatus(status) {
  const count = status?.totalInIndex ?? 0;
  const last = count > 0 && status?.lastIndexedAt
    ? new Date(status.lastIndexedAt).toLocaleString()
    : "jamais";
  return `Index : ${count} mail(s) · mode ${status?.mode || "inconnu"} · derniere mise a jour : ${last}`;
}

async function refreshIndexStatus() {
  const status = await sendToBackground({ type: "GET_INDEX_STATUS" });
  indexStatusEl.textContent = formatIndexStatus(status);
}

async function runIndexing() {
  if (indexBtn.disabled) return;
  indexBtn.disabled = true;
  const previousText = indexBtn.textContent;
  indexBtn.textContent = "Indexation en cours...";
  try {
    const result = await withUiTimeout(
      sendToBackground({ type: "INDEX_MAILBOX" }),
      180_000,
      "L'indexation prend trop de temps. Le bouton a ete reactive; reduis la taille du lot ou verifie le serveur d'embedding."
    );
    await refreshIndexStatus();
    const matchedFolders = result.scanDiagnostics?.matchedFolders?.length ?? 0;
    const folderErrors = result.scanDiagnostics?.folderErrors?.length ?? 0;
    indexStatusEl.textContent +=
      ` · dernier passage : ${result.scanned} lu(s), ${result.indexed} ajoute(s), ` +
      `${result.failed} erreur(s), ${matchedFolders} dossier(s)`;
    if (result.scanned === 0 && matchedFolders === 0) {
      indexStatusEl.textContent += " · aucun dossier ne correspond a la configuration";
    } else if (result.scanned === 0) {
      indexStatusEl.textContent += " · aucun nouveau mail dans la periode configuree";
    }
    if (result.reachedBatchLimit) {
      indexStatusEl.textContent += " · limite de lot atteinte, relance l'indexation pour continuer";
    }
    if (result.stoppedEarly) {
      indexStatusEl.textContent += " · temps maximal atteint, relance pour continuer";
    }
    if (result.scanDiagnostics?.stoppedEarly) {
      indexStatusEl.textContent += " · lecture des dossiers interrompue pour conserver le lot deja trouve";
    }
    if (folderErrors) {
      indexStatusEl.textContent += ` · ${folderErrors} dossier(s) ignore(s) car illisible(s)`;
    }
    if (result.embeddingFallbackReason) {
      indexStatusEl.textContent += " · embeddings indisponibles, index lexical utilise";
    }
  } catch (e) {
    indexStatusEl.textContent = `Erreur d'indexation : ${e.message}`;
  } finally {
    indexBtn.disabled = false;
    indexBtn.textContent = previousText;
  }
}

function appendSources(container, sources) {
  if (!sources?.length) return;
  const sourceBlock = document.createElement("div");
  sourceBlock.className = "sources";
  sourceBlock.appendChild(document.createTextNode("Sources :"));
  const list = document.createElement("ul");
  for (const source of sources) {
    const item = document.createElement("li");
    const date = source.type === "calendar"
      ? new Date(source.date).toLocaleString()
      : new Date(source.date).toLocaleDateString();
    item.textContent = `${source.subject} — ${source.author} (${date})`;
    if (source.type !== "calendar") {
      item.append(" ", createMailSourceButton(source));
    }
    list.appendChild(item);
  }
  sourceBlock.appendChild(list);
  container.appendChild(sourceBlock);
}

function appendRetrievalStatus(container, retrieval) {
  if (!retrieval) return;
  const status = document.createElement("div");
  status.className = "retrieval-status";
  if (retrieval.mode === "papotage") {
    status.textContent = "Papotage hors index mail.";
    container.appendChild(status);
    return;
  }
  const refresh = retrieval.indexRefresh;
  const refreshLabel = refresh?.attempted
    ? refresh.error
      ? `index non actualise : ${refresh.error}`
      : `index actualise, ${refresh.indexed} nouveau(x) mail(s)`
    : "index deja a jour";
  const searchLabel = retrieval.chatScope === "gossip" ? `Ragots ${retrieval.mode}` : `Recherche ${retrieval.mode}`;
  status.textContent = `${searchLabel} · ${retrieval.sourceCount || 0} source(s) · ${refreshLabel}`;
  container.appendChild(status);
}

function appendMessage(role, text, sources) {
  const emptyMsg = chatMessages.querySelector(".empty");
  if (emptyMsg) emptyMsg.remove();

  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  const textNode = document.createElement("div");
  textNode.className = "text";
  textNode.textContent = text;
  div.appendChild(textNode);
  appendSources(div, sources);

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

async function sendQuestion(question) {
  appendMessage("user", question);
  chatInput.value = "";
  chatInput.disabled = true;
  const scope = chatScope.value;

  indexStatusEl.textContent = "Index : mise a jour en arriere-plan...";
  sendToBackground({ type: "ENSURE_MAIL_INDEX" })
    .then((result) => {
      if (result?.error) {
        indexStatusEl.textContent = `Index non actualise : ${result.error}`;
        return;
      }
      return refreshIndexStatus();
    })
    .catch((error) => {
      indexStatusEl.textContent = `Index non actualise : ${error.message}`;
    });

  const pending = appendMessage(
    "assistant",
    scope === "casual"
      ? "Madame Michu soupire : visiblement, sa tranquillite pouvait attendre..."
      : scope === "gossip"
        ? "Madame Michu a entendu le mot ragot et fouille frenetiquement ses fiches..."
        : "Madame Michu leve les yeux au ciel et consulte ses fiches..."
  );

  try {
    const { answer, sources, retrieval } = await sendToBackground({
      type: "CHAT_QUERY",
      question,
      history: chatHistory,
      scope,
    });

    pending.querySelector(".text").textContent = answer;
    appendRetrievalStatus(pending, retrieval);
    appendSources(pending, sources);

    const historyScope = retrieval?.chatScope || (retrieval?.mode === "papotage" ? "casual" : "mail");
    chatHistory.push({ role: "user", content: question, scope: historyScope });
    chatHistory.push({ role: "assistant", content: answer, scope: historyScope });
    // On garde un historique court pour ne pas faire deriver le prompt.
    chatHistory = chatHistory.slice(-16);
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

refreshIndexStatus().catch((error) => {
  indexStatusEl.textContent = `Index indisponible : ${error.message}`;
});
