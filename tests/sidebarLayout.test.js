const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

test("affiche les rapports et le chat dans une meme grille accessible", () => {
  const html = readFileSync(join(__dirname, "..", "ui", "sidebar", "sidebar.html"), "utf8");
  const css = readFileSync(join(__dirname, "..", "ui", "sidebar", "sidebar.css"), "utf8");
  const script = readFileSync(join(__dirname, "..", "ui", "sidebar", "sidebar.js"), "utf8");
  const chatScript = readFileSync(join(__dirname, "..", "ui", "sidebar", "chat.js"), "utf8");

  assert.match(html, /class="workspace-grid"/);
  assert.match(html, /id="reports-pane"[^>]+aria-labelledby="reportsHeading"/);
  assert.match(html, /id="chat-pane"[^>]+aria-labelledby="chatHeading"/);
  assert.match(html, /id="chatPortrait"[^>]+src="portraits\/default\.png"/);
  assert.match(html, /id="chatPortraitMood"[^>]+aria-live="polite"/);
  assert.doesNotMatch(html, /Ce qui merite ton attention/i);
  assert.doesNotMatch(html, /id="indexStatus"|id="indexBtn"|class="panel index-panel"/);
  assert.doesNotMatch(html, /id="chatScope"|Mode de conversation/);
  assert.doesNotMatch(chatScript, /formatIndexStatus|refreshIndexStatus|runIndexing/);
  assert.doesNotMatch(chatScript, /appendRetrievalStatus|retrieval-status/);
  assert.match(chatScript, /createElement\("details"\)/);
  assert.match(chatScript, /createElement\("summary"\)/);
  assert.doesNotMatch(chatScript, /chatScope\.value|getElementById\("chatScope"\)/);
  assert.match(chatScript, /const scope = "auto"/);
  assert.match(chatScript, /type:\s*"ENSURE_MAIL_INDEX"/);
  assert.ok(html.indexOf('id="reports-pane"') < html.indexOf('id="chat-pane"'));
  assert.doesNotMatch(html, /class="tabs"/);
  assert.doesNotMatch(script, /\.tab-btn/);
  assert.match(script, /await loadLastSummary\(\);[\s\S]*loadCalendars\(\);[\s\S]*await regenerate\(\{ force: false \}\)/);
  assert.match(script, /initializeSidebar\(\)\.catch/);
  assert.match(script, /sendToBackgroundPort\(/);
  assert.match(script, /MAX_INLINE_MAIL_SOURCES = 4/);
  assert.match(script, /mail-source-overflow/);
  assert.match(script, /renderWeatherCard/);
  assert.match(css, /\.weather-card\s*\{/);
  assert.match(script, /regenerateBtn\.addEventListener\("click", \(\) => regenerate\(\{ force: true \}\)\)/);
  // SUMMARY_RANGE_LABELS a pour cles "fr"/"en", pas "day"/"week"/"month" : verifier
  // contre l'objet lui-meme rendait Semaine/Mois definitivement inactivables.
  assert.match(script, /Object\.hasOwn\(SUMMARY_RANGE_LABELS\.fr, range\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1\.55fr\) minmax\(400px, 1fr\)/);
  assert.match(css, /@media \(min-width: 980px\)/);
  assert.match(css, /\.chat-portrait\s*\{[^}]*border-radius:\s*50%/);
});

test("change le portrait selon l'humeur retournee par le chat", () => {
  const script = readFileSync(join(__dirname, "..", "ui", "sidebar", "chat.js"), "utf8");

  for (const mood of [
    "exasperee",
    "furieuse",
    "soupconneuse",
    "ragot",
    "profil-meprisant",
    "inspection-penchee",
    "ragot-renverse",
    "epuisee-affaissee",
  ]) {
    assert.match(script, new RegExp(`['\"]?${mood}['\"]?\\s*:`));
  }
  assert.match(script, /setChatPortrait\(mood\)/);
  assert.doesNotMatch(script, /setChatPortrait\((?:scope|"furieuse")/);
  assert.match(
    script,
    /renderMarkdown\(pending\.querySelector\("\.text"\), normalizeChatMarkdown\(answer\)\);\s*setChatPortrait\(mood\)/
  );
});

test("laisse chaque colonne defiler pour son compte sans defilement de page", () => {
  const css = readFileSync(join(__dirname, "..", "ui", "sidebar", "sidebar.css"), "utf8");

  const body = css.slice(css.indexOf("body {"), css.indexOf("}", css.indexOf("body {")));
  assert.match(body, /overflow:\s*hidden/);
  assert.match(body, /height:\s*100%/);

  const wide = css.slice(css.indexOf("@media (min-width: 980px)"));
  // La page ne defile pas : le defilement appartient a chaque colonne.
  assert.match(wide, /main\s*\{\s*overflow:\s*hidden;\s*\}/);
  assert.match(wide, /\.reports-column\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(wide, /\.chat-column\s*\{[^}]*overflow-y:\s*auto/);
  // Sans min-height nulle, une colonne en flex refuse de se comprimer et
  // repousse le defilement vers la page.
  assert.match(wide, /\.workspace-grid\s*\{[^}]*min-height:\s*0/);
  assert.match(wide, /\.workspace-column\s*\{[^}]*min-height:\s*0/);
  assert.match(wide, /\.chat-panel\s*\{[^}]*min-height:\s*0/);
  // L'ancien contournement : une colonne collante haute d'un viewport.
  assert.doesNotMatch(wide, /position:\s*sticky/);
  assert.doesNotMatch(wide, /100vh/);
});

test("integre l'identite visuelle de Madame Michu dans l'interface", () => {
  const html = readFileSync(join(__dirname, "..", "ui", "sidebar", "sidebar.html"), "utf8");
  const css = readFileSync(join(__dirname, "..", "ui", "sidebar", "sidebar.css"), "utf8");
  const script = readFileSync(join(__dirname, "..", "ui", "sidebar", "sidebar.js"), "utf8");
  const optionsHtml = readFileSync(join(__dirname, "..", "ui", "options", "options.html"), "utf8");
  const optionsCss = readFileSync(join(__dirname, "..", "ui", "options", "options.css"), "utf8");

  assert.match(html, /class="brand"[\s\S]*madame-michu-48\.png/);
  assert.match(html, /id="optionsBtn"[^>]+>⚙<\/button>/);
  assert.match(html, /id="languageFrBtn"[^>]+>🇫🇷<\/button>/);
  assert.match(html, /id="languageEnBtn"[^>]+>🇬🇧<\/button>/);
  assert.match(html, /id="chatHeading">Demande à Madame Michu<\/h2>/);
  assert.match(html, /Tu peux commencer par : « Quoi de neuf \? »/);
  assert.match(script, /chat: "Ask Madame Michu"/);
  assert.match(script, /You could start with: “What's new\?”/);
  assert.match(script, /switchLanguage/);
  assert.match(script, /uiLanguage/);
  assert.match(html, /class="column-header chat-header"/);
  assert.match(html, /class="chat-portrait-caption"[^>]+aria-live="polite"/);
  assert.match(css, /--accent:\s*#66733a/);
  assert.match(css, /\.chat-header\s*\{[^}]*linear-gradient/);
  assert.match(css, /\.chat-form\s*\{[^}]*grid-template-columns/);
  assert.match(optionsHtml, /class="options-header"[\s\S]*madame-michu-96\.png/);
  assert.match(optionsCss, /\.options-header\s*\{/);
  assert.match(optionsCss, /fieldset\s*\{[^}]*border-radius:\s*14px/);
});
