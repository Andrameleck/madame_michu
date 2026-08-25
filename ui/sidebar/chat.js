// Logique de l'onglet Chat : recherche dans les mails ou conversation generale.

const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatPortrait = document.getElementById("chatPortrait");
const chatPortraitMood = document.getElementById("chatPortraitMood");

let chatHistory = [];

function chatUiLanguage() {
  return typeof uiLanguage === "string" ? uiLanguage : "fr";
}

const CHAT_PORTRAITS = Object.freeze({
  default: { file: "default.png", fr: "blasée", en: "unimpressed" },
  exasperee: { file: "exasperee.png", fr: "exaspérée", en: "exasperated" },
  furieuse: { file: "furieuse.png", fr: "furieuse", en: "furious" },
  soupconneuse: { file: "soupconneuse.png", fr: "soupçonneuse", en: "suspicious" },
  ragot: { file: "ragot.png", fr: "ravie par un ragot", en: "delighted by gossip" },
  "profil-meprisant": { file: "profil-meprisant.png", fr: "méprisante", en: "scornful" },
  "inspection-penchee": { file: "inspection-penchee.png", fr: "en pleine inspection", en: "inspecting" },
  "ragot-renverse": { file: "ragot-renverse.png", fr: "surexcitée par les ragots", en: "gossip-fuelled" },
  "epuisee-affaissee": { file: "epuisee-affaissee.png", fr: "épuisée", en: "exhausted" },
});

function setChatPortrait(mood) {
  const portrait = CHAT_PORTRAITS[mood] || CHAT_PORTRAITS.default;
  const language = chatUiLanguage();
  const label = portrait[language] || portrait.fr;
  chatPortrait.src = `portraits/${portrait.file}`;
  chatPortrait.alt = `Madame Michu, ${label}`;
  if (chatPortrait.dataset) chatPortrait.dataset.mood = mood in CHAT_PORTRAITS ? mood : "default";
  chatPortraitMood.textContent = label;
}

// sidebar.js a deja charge la langue conservee lorsque ce second script arrive.
setChatPortrait("default");

function appendSources(container, sources) {
  if (!sources?.length) return;
  const sourceBlock = document.createElement("details");
  sourceBlock.className = "sources";
  const toggle = document.createElement("summary");
  toggle.textContent = `Sources (${sources.length})`;
  sourceBlock.appendChild(toggle);
  const list = document.createElement("ul");
  for (const source of sources) {
    const item = document.createElement("li");
    const parsedDate = new Date(source.date);
    const date = Number.isFinite(parsedDate.getTime())
      ? (source.type === "calendar" ? parsedDate.toLocaleString() : parsedDate.toLocaleDateString())
      : String(source.date || "");
    item.textContent = `${source.subject} — ${source.author} (${date})`;
    if (source.type === "external" && source.url) {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = chatUiLanguage() === "en" ? "Open" : "Ouvrir";
      item.append(" ", link);
    } else if (source.type !== "calendar") {
      item.append(" ", createMailSourceButton(source));
    }
    list.appendChild(item);
  }
  sourceBlock.appendChild(list);
  container.appendChild(sourceBlock);
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

function normalizeChatMarkdown(text) {
  return String(text || "")
    // Certains modeles renvoient leurs puces sur une ligne unique. On restaure
    // uniquement les separateurs precedant un libelle Markdown en gras.
    .replace(/\s+(?:[-•]|\d+[.)])\s+(?=\*\*[^*]+\*\*\s*:)/g, "\n- ")
    .trim();
}

function chatFailureReply(error) {
  const details = String(error?.message || error || "").toLocaleLowerCase();
  const isShiftOver = /\b(401|403|429)\b|authent|token|quota|credit|rate.?limit|too many requests|usage limit/.test(details);
  if (chatUiLanguage() === "en") {
    return isShiftOver ? "Sorry, I've finished for the day." : "Sorry, I'm on my break.";
  }
  return isShiftOver ? "Désolée, j'ai fini ma journée." : "Désolée, je suis en pause.";
}

async function sendQuestion(question) {
  appendMessage("user", question);
  chatInput.value = "";
  chatInput.disabled = true;
  const scope = "auto";

  // L'entretien de l'index reste automatique, mais cette plomberie n'occupe
  // plus un panneau permanent dans la conversation.
  sendToBackground({ type: "ENSURE_MAIL_INDEX" }).catch(() => {});

  const pending = appendMessage(
    "assistant",
    chatUiLanguage() === "en"
      ? "Madame Michu rolls her eyes and consults her files..."
      : "Madame Michu leve les yeux au ciel et consulte ses fiches..."
  );

  try {
    const { answer, sources, retrieval, mood } = await sendToBackground({
      type: "CHAT_QUERY",
      question,
      history: chatHistory,
      scope,
    });

    renderMarkdown(pending.querySelector(".text"), normalizeChatMarkdown(answer));
    setChatPortrait(mood);
    appendSources(pending, sources);

    const historyScope = retrieval?.chatScope || (retrieval?.mode === "papotage" ? "casual" : "mail");
    const historyContext = retrieval?.newsReference
      ? { newsReference: retrieval.newsReference }
      : {};
    chatHistory.push({ role: "user", content: question, scope: historyScope, ...historyContext });
    chatHistory.push({ role: "assistant", content: answer, scope: historyScope, sources, ...historyContext });
    // Douze tours suffisent pour suivre les evolutions sans saturer le contexte du LLM.
    chatHistory = chatHistory.slice(-24);
  } catch (e) {
    pending.classList.add("chat-error");
    pending.querySelector(".text").textContent = chatFailureReply(e);
    setChatPortrait("epuisee-affaissee");
    console.warn("Madame Michu n'a pas pu repondre", e);
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
