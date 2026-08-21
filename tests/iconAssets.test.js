const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const root = join(__dirname, "..");

function pngDimensions(path) {
  const data = readFileSync(path);
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test("fournit le portrait de Madame Michu aux tailles du manifeste", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

  for (const size of [48, 96]) {
    const relativePath = manifest.icons[String(size)];
    const path = join(root, relativePath);
    assert.equal(existsSync(path), true, `${relativePath} est absent`);
    assert.deepEqual(pngDimensions(path), { width: size, height: size });
  }
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
});

test("conserve les expressions et poses haute definition", () => {
  const artworkDirectory = join(root, "artwork", "madame-michu");
  for (const expression of [
    "default",
    "exasperee",
    "furieuse",
    "soupconneuse",
    "ragot",
    "profil-meprisant",
    "inspection-penchee",
    "ragot-renverse",
    "epuisee-affaissee",
  ]) {
    const path = join(artworkDirectory, `madame-michu-${expression}-source.png`);
    assert.equal(existsSync(path), true, `${expression} est absente`);
    assert.deepEqual(pngDimensions(path), { width: 1254, height: 1254 });
  }
});

test("embarque les portraits optimises utilises par le chat", () => {
  const portraitDirectory = join(root, "ui", "sidebar", "portraits");
  for (const portrait of [
    "default",
    "exasperee",
    "furieuse",
    "soupconneuse",
    "ragot",
    "profil-meprisant",
    "inspection-penchee",
    "ragot-renverse",
    "epuisee-affaissee",
  ]) {
    const path = join(portraitDirectory, `${portrait}.png`);
    assert.equal(existsSync(path), true, `${portrait} n'est pas embarquee`);
    assert.deepEqual(pngDimensions(path), { width: 256, height: 256 });
  }
});
