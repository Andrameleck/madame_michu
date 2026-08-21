const { execFileSync } = require("node:child_process");
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const sourceDirectories = ["background", "calendar", "llm", "utils", "ui", "experiments"];

function collectJavaScript(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...collectJavaScript(path));
    else if (path.endsWith(".js")) files.push(path);
  }
  return files;
}

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
JSON.parse(readFileSync(join(root, "experiments/assistantCalendar/schema.json"), "utf8"));

if (manifest.version !== packageManifest.version) {
  throw new Error("Les versions de manifest.json et package.json doivent etre identiques.");
}
if (manifest.optional_host_permissions?.some((origin) => origin.startsWith("http://"))) {
  throw new Error("Les permissions HTTP distantes sont interdites.");
}

for (const directory of sourceDirectories) {
  for (const file of collectJavaScript(join(root, directory))) {
    execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  }
}

console.log("Manifestes JSON et fichiers JavaScript valides.");
