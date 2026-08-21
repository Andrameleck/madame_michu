const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

test("affiche les rapports et le chat dans une meme grille accessible", () => {
  const html = readFileSync(join(__dirname, "..", "ui", "sidebar", "sidebar.html"), "utf8");
  const css = readFileSync(join(__dirname, "..", "ui", "sidebar", "sidebar.css"), "utf8");
  const script = readFileSync(join(__dirname, "..", "ui", "sidebar", "sidebar.js"), "utf8");

  assert.match(html, /class="workspace-grid"/);
  assert.match(html, /id="reports-pane"[^>]+aria-labelledby="reportsHeading"/);
  assert.match(html, /id="chat-pane"[^>]+aria-labelledby="chatHeading"/);
  assert.ok(html.indexOf('id="reports-pane"') < html.indexOf('id="chat-pane"'));
  assert.doesNotMatch(html, /class="tabs"/);
  assert.doesNotMatch(script, /\.tab-btn/);
  assert.match(script, /loadCalendars\(\);[\s\S]*regenerate\(\)\.catch/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 3fr\) minmax\(390px, 2fr\)/);
  assert.match(css, /@media \(min-width: 980px\)/);
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
