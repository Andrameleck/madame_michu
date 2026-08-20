const form = document.getElementById("optionsForm");
const saveStatus = document.getElementById("saveStatus");

const fields = {
  ollamaBaseUrl: document.getElementById("ollamaBaseUrl"),
  ollamaModel: document.getElementById("ollamaModel"),
  apiKey: document.getElementById("apiKey"),
  summaryTime: document.getElementById("summaryTime"),
  scanFolders: document.getElementById("scanFolders"),
  minConfidence: document.getElementById("minConfidence"),
  maxEmailsPerRun: document.getElementById("maxEmailsPerRun"),
  maxBodyChars: document.getElementById("maxBodyChars"),
  dryRun: document.getElementById("dryRun"),
  embeddingModel: document.getElementById("embeddingModel"),
  indexFolders: document.getElementById("indexFolders"),
  indexLookbackDays: document.getElementById("indexLookbackDays"),
  indexBatchSize: document.getElementById("indexBatchSize"),
  chatTopK: document.getElementById("chatTopK"),
};

const DEFAULTS = {
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
  apiKey: "",
  summaryHour: 8,
  summaryMinute: 0,
  scanFolders: ["INBOX"],
  minConfidence: "moyenne",
  maxEmailsPerRun: 40,
  maxBodyChars: 2000,
  dryRun: false,
  embeddingModel: "nomic-embed-text",
  indexFolders: ["INBOX"],
  indexLookbackDays: 90,
  indexBatchSize: 100,
  chatTopK: 6,
};

async function load() {
  const settings = await messenger.storage.local.get(DEFAULTS);

  fields.ollamaBaseUrl.value = settings.ollamaBaseUrl;
  fields.ollamaModel.value = settings.ollamaModel;
  fields.apiKey.value = settings.apiKey;
  fields.summaryTime.value = `${pad(settings.summaryHour)}:${pad(settings.summaryMinute)}`;
  fields.scanFolders.value = (settings.scanFolders || []).join(", ");
  fields.minConfidence.value = settings.minConfidence;
  fields.maxEmailsPerRun.value = settings.maxEmailsPerRun;
  fields.maxBodyChars.value = settings.maxBodyChars;
  fields.dryRun.checked = settings.dryRun;
  fields.embeddingModel.value = settings.embeddingModel;
  fields.indexFolders.value = (settings.indexFolders || []).join(", ");
  fields.indexLookbackDays.value = settings.indexLookbackDays;
  fields.indexBatchSize.value = settings.indexBatchSize;
  fields.chatTopK.value = settings.chatTopK;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

async function save(evt) {
  evt.preventDefault();

  const [summaryHour, summaryMinute] = fields.summaryTime.value.split(":").map(Number);

  await messenger.storage.local.set({
    ollamaBaseUrl: fields.ollamaBaseUrl.value.trim(),
    ollamaModel: fields.ollamaModel.value.trim(),
    apiKey: fields.apiKey.value,
    summaryHour,
    summaryMinute,
    scanFolders: fields.scanFolders.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    minConfidence: fields.minConfidence.value,
    maxEmailsPerRun: Number(fields.maxEmailsPerRun.value),
    maxBodyChars: Number(fields.maxBodyChars.value),
    dryRun: fields.dryRun.checked,
    embeddingModel: fields.embeddingModel.value.trim(),
    indexFolders: fields.indexFolders.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    indexLookbackDays: Number(fields.indexLookbackDays.value),
    indexBatchSize: Number(fields.indexBatchSize.value),
    chatTopK: Number(fields.chatTopK.value),
  });

  await messenger.runtime.sendMessage({ type: "RESCHEDULE_ALARM" });

  saveStatus.hidden = false;
  setTimeout(() => (saveStatus.hidden = true), 2000);
}

form.addEventListener("submit", save);
load();
