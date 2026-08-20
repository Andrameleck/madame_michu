// Conversion HTML -> texte propre pour reduire le volume envoye au LLM.
// Utilise DOMParser (disponible dans le contexte d'extension background de Thunderbird).

function htmlToText(html) {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, head").forEach((el) => el.remove());
    const text = doc.body ? doc.body.textContent : doc.documentElement.textContent;
    return collapseWhitespace(text);
  } catch (e) {
    logger.warn("htmlToText: parsing echoue, fallback strip regex", e);
    return collapseWhitespace(html.replace(/<[^>]+>/g, " "));
  }
}

function collapseWhitespace(text) {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Tronque un texte a maxChars, en essayant de couper sur une frontiere de mot.
function truncateText(text, maxChars) {
  if (!text || text.length <= maxChars) return text || "";
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  const safeCut = lastSpace > maxChars * 0.8 ? cut.slice(0, lastSpace) : cut;
  return `${safeCut}\n[...mail tronque...]`;
}
