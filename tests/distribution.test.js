const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const root = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("possede des metadonnees de diffusion stables", () => {
  assert.equal(manifest.version, packageManifest.version);
  assert.match(manifest.browser_specific_settings.gecko.id, /@addons\.thunderbird\.net$/);
  assert.match(manifest.browser_specific_settings.gecko.strict_max_version, /^\d+\.\*$/);
  assert.ok(manifest.homepage_url.startsWith("https://"));
});

test("limite les acces permanents aux services locaux et a Open-Meteo", () => {
  assert.deepEqual(manifest.host_permissions.sort(), [
    "http://127.0.0.1/*",
    "http://[::1]/*",
    "http://localhost/*",
    "https://api.open-meteo.com/*",
    "https://geocoding-api.open-meteo.com/*",
    "https://theconversation.com/*",
  ].sort());
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
});

test("embarque la politique de confidentialite", () => {
  assert.equal(existsSync(join(root, "PRIVACY.md")), true);
  assert.equal(existsSync(join(root, "ui", "options", "privacy.html")), true);
  assert.match(
    readFileSync(join(root, "ui", "options", "options.html"), "utf8"),
    /id="remoteDataConsent"/
  );
});

test("declare et fournit la licence AGPL version 3", () => {
  assert.equal(packageManifest.license, "AGPL-3.0-only");
  assert.match(
    readFileSync(join(root, "LICENSE"), "utf8"),
    /GNU AFFERO GENERAL PUBLIC LICENSE[\s\S]+Version 3, 19 November 2007/
  );
});

test("documente et automatise le paquet source ATN", () => {
  assert.equal(packageManifest.scripts["package:source"], "bash tools/package-source.sh");
  const instructions = readFileSync(join(root, "SOURCE_BUILD.md"), "utf8");
  assert.match(instructions, /Node\.js 18\.19\.1/);
  assert.match(instructions, /npm 9\.2\.0/);
  assert.match(instructions, /Info-ZIP `zip` 3\.0/);
  assert.match(instructions, /npm run package/);
  assert.equal(existsSync(join(root, "ARCHITECTURE.md")), true);
  assert.equal(existsSync(join(root, "CONTRIBUTING.md")), true);
  const sourcePackage = readFileSync(join(root, "tools", "package-source.sh"), "utf8");
  assert.match(sourcePackage, /ARCHITECTURE\.md CONTRIBUTING\.md/);
});

test("n'embarque plus de chemin de recherche web dormant", () => {
  const provider = readFileSync(join(root, "llm", "providerClient.js"), "utf8");
  const anthropic = readFileSync(join(root, "llm", "anthropicClient.js"), "utf8");
  assert.doesNotMatch(provider, /webSearch|web_search/);
  assert.doesNotMatch(anthropic, /webSearch|web_search/);
});
