// Reduction d'un mail a du texte exploitable par un LLM. Deux objectifs :
// diminuer le volume envoye, et retirer le decor (citations, signatures,
// pieds de page) qui fait deriver les resumes vers des banalites.

const QUOTE_LINE = /^\s*(>|&gt;)/;
const REPLY_SEPARATORS = [
  /^-{2,}\s*Message d'origine\s*-{2,}/i,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^Le .+ a ecrit\s*:$/i,
  /^On .+ wrote\s*:$/i,
  /^De\s*:.*$/i,
  /^From\s*:.*$/i,
];
const SIGNATURE_SEPARATOR = /^--\s*$/;

export function htmlToText(html) {
  if (!html) return "";
  if (typeof DOMParser === "undefined") {
    return collapseWhitespace(String(html).replace(/<[^>]+>/g, " "));
  }
  try {
    const document = new DOMParser().parseFromString(html, "text/html");
    document.querySelectorAll("script, style, head, blockquote").forEach((node) => node.remove());
    const root = document.body || document.documentElement;
    return collapseWhitespace(root ? root.textContent : "");
  } catch {
    return collapseWhitespace(String(html).replace(/<[^>]+>/g, " "));
  }
}

export function collapseWhitespace(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Coupe l'historique de conversation et la signature. */
export function stripQuotedText(text) {
  const lines = String(text || "").split("\n");
  const kept = [];
  for (const line of lines) {
    if (REPLY_SEPARATORS.some((pattern) => pattern.test(line.trim()))) break;
    if (SIGNATURE_SEPARATOR.test(line)) break;
    if (QUOTE_LINE.test(line)) continue;
    kept.push(line);
  }
  const body = collapseWhitespace(kept.join("\n"));
  // Un mail entierement cite ne doit pas devenir vide : mieux vaut le texte brut.
  return body || collapseWhitespace(text);
}

/** Tronque sur une frontiere de mot et signale la coupe au modele. */
export function truncate(text, maxChars) {
  const value = String(text || "");
  if (!maxChars || value.length <= maxChars) return value;
  const cut = value.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > maxChars * 0.8 ? cut.slice(0, lastSpace) : cut;
  return `${safe}\n[... message tronque ...]`;
}
