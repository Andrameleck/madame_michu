const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "ui/options/options.html"), "utf8");
const script = fs.readFileSync(path.join(root, "ui/options/i18n.js"), "utf8");
const options = fs.readFileSync(path.join(root, "ui/options/options.js"), "utf8");

test("the options page loads its translations before its controller", () => {
  assert.ok(html.indexOf('src="i18n.js"') < html.indexOf('src="options.js"'));
  assert.match(options, /applyOptionsLanguage\(settings\.uiLanguage\)/);
});

test("the main option groups and privacy warning have English translations", () => {
  for (const label of [
    "Options de Madame Michu",
    "Fournisseurs LLM",
    "Configuration de Madame Michu",
    "Flash d'actualite",
    "Confidentialite",
    "Avertissement : Madame Michu ne peut pas verifier",
  ]) assert.ok(script.includes(label), `missing translation source: ${label}`);
  assert.match(script, /Madame Michu settings/);
  assert.match(script, /LLM providers/);
  assert.match(script, /Privacy/);
});
