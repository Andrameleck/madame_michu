const form = document.getElementById("optionsForm");
const saveStatus = document.getElementById("saveStatus");

const fields = {
  providerEnabled: document.getElementById("providerEnabled"),
  providerName: document.getElementById("providerName"),
  llmProvider: document.getElementById("llmProvider"),
  providerBaseUrl: document.getElementById("providerBaseUrl"),
  providerModel: document.getElementById("providerModel"),
  apiKey: document.getElementById("apiKey"),
  embeddingModel: document.getElementById("embeddingModel"),
  summaryTime: document.getElementById("summaryTime"),
  autoRefreshMinutes: document.getElementById("autoRefreshMinutes"),
  scanAllFolders: document.getElementById("scanAllFolders"),
  scanFolders: document.getElementById("scanFolders"),
  minConfidence: document.getElementById("minConfidence"),
  autoCreateEvents: document.getElementById("autoCreateEvents"),
  defaultCalendarId: document.getElementById("defaultCalendarId"),
  maxEmailsPerRun: document.getElementById("maxEmailsPerRun"),
  maxBodyChars: document.getElementById("maxBodyChars"),
  dryRun: document.getElementById("dryRun"),
  indexAllFolders: document.getElementById("indexAllFolders"),
  indexFolders: document.getElementById("indexFolders"),
  indexLookbackDays: document.getElementById("indexLookbackDays"),
  indexBatchSize: document.getElementById("indexBatchSize"),
  chatTopK: document.getElementById("chatTopK"),
};

const providerTabs = document.getElementById("providerTabs");
const preferredProviderSelect = document.getElementById("preferredProviderId");
const addProviderBtn = document.getElementById("addProviderBtn");
const moveProviderLeftBtn = document.getElementById("moveProviderLeftBtn");
const moveProviderRightBtn = document.getElementById("moveProviderRightBtn");
const deleteProviderBtn = document.getElementById("deleteProviderBtn");
const apiKeyField = document.getElementById("apiKeyField");
const providerBaseUrlField = document.getElementById("providerBaseUrlField");
const embeddingModelField = document.getElementById("embeddingModelField");
const codexAuthField = document.getElementById("codexAuthField");
const connectCodexBtn = document.getElementById("connectCodexBtn");
const disconnectCodexBtn = document.getElementById("disconnectCodexBtn");
const codexAuthStatus = document.getElementById("codexAuthStatus");
const codexManualCallback = document.getElementById("codexManualCallback");
const codexCallbackUrl = document.getElementById("codexCallbackUrl");
const completeCodexBtn = document.getElementById("completeCodexBtn");
const providerHint = document.getElementById("providerHint");
const testProviderBtn = document.getElementById("testProviderBtn");
const providerTestStatus = document.getElementById("providerTestStatus");
const loadModelsBtn = document.getElementById("loadModelsBtn");
const providerModelSelectField = document.getElementById("providerModelSelectField");
const providerModelSelect = document.getElementById("providerModelSelect");
const modelsStatus = document.getElementById("modelsStatus");
const calendarOptionsStatus = document.getElementById("calendarOptionsStatus");
const scanFoldersField = document.getElementById("scanFoldersField");
const indexFoldersField = document.getElementById("indexFoldersField");

const DEFAULTS = {
  llmProfiles: [],
  preferredProviderId: "",
  llmProvider: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
  providerBaseUrl: "",
  providerModel: "",
  apiKey: "",
  embeddingModel: "nomic-embed-text",
  summaryHour: 8,
  summaryMinute: 0,
  autoRefreshMinutes: 60,
  scanAllFolders: true,
  scanFolders: ["INBOX"],
  minConfidence: "moyenne",
  autoCreateEvents: true,
  defaultCalendarId: "",
  maxEmailsPerRun: 40,
  maxBodyChars: 2000,
  dryRun: false,
  indexAllFolders: true,
  indexFolders: ["INBOX"],
  indexLookbackDays: 90,
  indexBatchSize: 100,
  chatTopK: 6,
};

let profiles = [];
let selectedProfileId = "";
let preferredProviderId = "";
let providerTestGeneration = 0;
let modelsRequestGeneration = 0;
let hasWritableCalendars = false;
let renderingProfile = false;
let codexStatusTimer = null;
let profileSaveQueue = Promise.resolve();
let profileSaveTimer = null;

function createProfile(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: `Profil ${profiles.length + 1}`,
    enabled: true,
    type: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    apiKey: "",
    embeddingModel: "",
    ...overrides,
  };
}

function migrateLegacyProfile(settings) {
  return createProfile({
    name: "Provider principal",
    type: settings.llmProvider || "ollama",
    baseUrl: settings.providerBaseUrl || settings.ollamaBaseUrl,
    model: settings.providerModel || settings.ollamaModel,
    apiKey: settings.apiKey || "",
    embeddingModel: settings.embeddingModel || "",
  });
}

function currentProfile() {
  return profiles.find((profile) => profile.id === selectedProfileId) || profiles[0];
}

function ensurePreferredProvider() {
  const preferred = profiles.find(
    (profile) => profile.id === preferredProviderId && profile.enabled !== false
  );
  if (preferred) return;
  preferredProviderId = profiles.find((profile) => profile.enabled !== false)?.id || profiles[0]?.id || "";
}

function renderPreferredProviderOptions() {
  ensurePreferredProvider();
  preferredProviderSelect.replaceChildren();
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.enabled === false
      ? `${profile.name || "Sans nom"} (desactive)`
      : profile.name || "Sans nom";
    option.disabled = profile.enabled === false;
    preferredProviderSelect.appendChild(option);
  }
  preferredProviderSelect.value = preferredProviderId;
  preferredProviderSelect.disabled = !profiles.some((profile) => profile.enabled !== false);
}

function syncCurrentProfile() {
  if (renderingProfile) return;
  const profile = currentProfile();
  if (!profile) return;
  Object.assign(profile, {
    enabled: fields.providerEnabled.checked,
    name: fields.providerName.value.trim(),
    type: fields.llmProvider.value,
    baseUrl: fields.providerBaseUrl.value.trim(),
    model: fields.providerModel.value.trim(),
    apiKey: ["ollama", "openai-codex"].includes(fields.llmProvider.value) ? "" : fields.apiKey.value,
    embeddingModel: ["anthropic", "openai-codex"].includes(fields.llmProvider.value)
      ? ""
      : fields.embeddingModel.value.trim(),
  });
  renderProviderTabs();
}

function profileDraftSnapshot() {
  syncCurrentProfile();
  return profiles.map((profile) => {
    const isCodex = profile.type === "openai-codex";
    return {
      ...profile,
      baseUrl: isCodex ? "https://chatgpt.com/backend-api/codex" : profile.baseUrl.trim(),
      model: profile.model.trim(),
      apiKey: ["ollama", "openai-codex"].includes(profile.type) ? "" : profile.apiKey,
      embeddingModel: ["anthropic", "openai-codex"].includes(profile.type)
        ? ""
        : profile.embeddingModel.trim(),
    };
  });
}

function persistProfileDrafts() {
  if (profileSaveTimer) clearTimeout(profileSaveTimer);
  profileSaveTimer = null;
  const snapshot = profileDraftSnapshot();
  profileSaveQueue = profileSaveQueue
    .catch(() => {})
    .then(() => messenger.storage.local.set({
      llmProfiles: snapshot,
      preferredProviderId,
    }));
  return profileSaveQueue;
}

function scheduleProfileDraftSave() {
  if (profileSaveTimer) clearTimeout(profileSaveTimer);
  profileSaveTimer = setTimeout(persistProfileDraftsSilently, 350);
}

function persistProfileDraftsSilently() {
  persistProfileDrafts().catch((error) => {
    showSaveStatus("error", error.message || "Impossible de sauvegarder les profils LLM.");
  });
}

function renderProviderTabs() {
  providerTabs.replaceChildren();
  profiles.forEach((profile, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "provider-tab";
    button.id = `provider-tab-${profile.id}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(profile.id === selectedProfileId));
    button.tabIndex = profile.id === selectedProfileId ? 0 : -1;
    button.textContent = `${index + 1}. ${profile.name || "Sans nom"}`;
    if (!profile.enabled) button.classList.add("disabled-profile");
    button.addEventListener("click", () => selectProfile(profile.id));
    button.addEventListener("keydown", (event) => handleProfileTabKeydown(event, index));
    providerTabs.appendChild(button);
  });
  renderPreferredProviderOptions();
}

function handleProfileTabKeydown(event, index) {
  let targetIndex = null;
  if (event.key === "ArrowRight") targetIndex = (index + 1) % profiles.length;
  if (event.key === "ArrowLeft") targetIndex = (index - 1 + profiles.length) % profiles.length;
  if (event.key === "Home") targetIndex = 0;
  if (event.key === "End") targetIndex = profiles.length - 1;
  if (targetIndex === null) return;
  event.preventDefault();
  selectProfile(profiles[targetIndex].id, true);
}

function selectProfile(profileId, focus = false) {
  selectedProfileId = profileId;
  renderProviderTabs();
  renderProviderEditor();
  invalidateProviderModels();
  if (focus) document.getElementById(`provider-tab-${profileId}`)?.focus();
}

function renderProviderEditor() {
  const profile = currentProfile();
  if (!profile) return;
  renderingProfile = true;
  fields.providerEnabled.checked = profile.enabled !== false;
  fields.providerName.value = profile.name || "";
  fields.llmProvider.value = profile.type || "openai-compatible";
  fields.providerBaseUrl.value = profile.baseUrl || "";
  fields.providerModel.value = profile.model || "";
  fields.apiKey.value = profile.apiKey || "";
  fields.embeddingModel.value = profile.embeddingModel || "";
  renderingProfile = false;
  const index = profiles.indexOf(profile);
  moveProviderLeftBtn.disabled = index <= 0;
  moveProviderRightBtn.disabled = index < 0 || index >= profiles.length - 1;
  deleteProviderBtn.disabled = profiles.length <= 1;
  updateProviderFields();
  refreshCodexAuthStatus();
}

function addProvider() {
  syncCurrentProfile();
  const profile = createProfile();
  profiles.push(profile);
  selectProfile(profile.id, true);
  persistProfileDraftsSilently();
}

async function deleteProvider() {
  if (profiles.length <= 1) return;
  const index = profiles.findIndex((profile) => profile.id === selectedProfileId);
  const removed = profiles[index];
  if (removed?.type === "openai-codex") {
    await messenger.runtime.sendMessage({ type: "LOGOUT_OPENAI_CODEX", profileId: removed.id });
  }
  profiles.splice(index, 1);
  selectedProfileId = profiles[Math.min(index, profiles.length - 1)].id;
  renderProviderTabs();
  renderProviderEditor();
  invalidateProviderModels();
  await persistProfileDrafts();
}

function moveProvider(direction) {
  syncCurrentProfile();
  const index = profiles.findIndex((profile) => profile.id === selectedProfileId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= profiles.length) return;
  [profiles[index], profiles[target]] = [profiles[target], profiles[index]];
  renderProviderTabs();
  renderProviderEditor();
  document.getElementById(`provider-tab-${selectedProfileId}`)?.focus();
  persistProfileDraftsSilently();
}

async function load() {
  const [settings, codexStorage] = await Promise.all([
    messenger.storage.local.get(DEFAULTS),
    messenger.storage.local.get({ openAiCodexCredentials: {} }),
  ]);
  profiles = Array.isArray(settings.llmProfiles) && settings.llmProfiles.length
    ? settings.llmProfiles.map((profile) => createProfile(profile))
    : [migrateLegacyProfile(settings)];
  const knownProfileIds = new Set(profiles.map((profile) => profile.id));
  const recoveredCodexProfiles = Object.entries(codexStorage.openAiCodexCredentials || {})
    .filter(([profileId, credentials]) =>
      !knownProfileIds.has(profileId) && (credentials?.refreshToken || credentials?.accessToken)
    )
    .map(([profileId, credentials]) => createProfile({
      id: profileId,
      name: credentials.email ? `ChatGPT - ${credentials.email}` : "ChatGPT recupere",
      type: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      model: "",
      apiKey: "",
      embeddingModel: "",
    }));
  if (recoveredCodexProfiles.length) {
    profiles.push(...recoveredCodexProfiles);
    await messenger.storage.local.set({ llmProfiles: profiles });
  }
  preferredProviderId = settings.preferredProviderId;
  ensurePreferredProvider();
  selectedProfileId = profiles[0].id;
  renderProviderTabs();
  renderProviderEditor();

  fields.summaryTime.value = `${pad(settings.summaryHour)}:${pad(settings.summaryMinute)}`;
  fields.autoRefreshMinutes.value = String(settings.autoRefreshMinutes);
  fields.scanAllFolders.checked = settings.scanAllFolders;
  fields.scanFolders.value = (settings.scanFolders || []).join(", ");
  fields.minConfidence.value = settings.minConfidence;
  fields.autoCreateEvents.checked = settings.autoCreateEvents;
  fields.maxEmailsPerRun.value = settings.maxEmailsPerRun;
  fields.maxBodyChars.value = settings.maxBodyChars;
  fields.dryRun.checked = settings.dryRun;
  fields.indexAllFolders.checked = settings.indexAllFolders;
  fields.indexFolders.value = (settings.indexFolders || []).join(", ");
  fields.indexLookbackDays.value = settings.indexLookbackDays;
  fields.indexBatchSize.value = settings.indexBatchSize;
  fields.chatTopK.value = settings.chatTopK;
  updateFolderFields();
  await loadCalendarOptions(settings.defaultCalendarId);
  if (recoveredCodexProfiles.length) {
    showSaveStatus(
      "success",
      `${recoveredCodexProfiles.length} profil(s) ChatGPT recupere(s). Selectionne leur modele.`
    );
  }
}

async function loadCalendarOptions(selectedCalendarId) {
  try {
    const calendars = await messenger.runtime.sendMessage({ type: "LIST_CALENDARS" });
    const writable = calendars.filter((calendar) => calendar.enabled && !calendar.readOnly);
    hasWritableCalendars = writable.length > 0;
    fields.defaultCalendarId.replaceChildren();
    for (const calendar of writable) {
      const option = document.createElement("option");
      option.value = calendar.id;
      option.textContent = calendar.name;
      fields.defaultCalendarId.appendChild(option);
    }
    const selected = writable.find((calendar) => calendar.id === selectedCalendarId)
      || writable.find((calendar) => calendar.name.toLocaleLowerCase().includes("inrae"))
      || writable[0];
    if (selected) fields.defaultCalendarId.value = selected.id;
    calendarOptionsStatus.textContent = selected
      ? `Calendrier automatique : ${selected.name}. Les doublons titre/date sont ignores.`
      : "Aucun calendrier actif et modifiable n'est disponible.";
  } catch (error) {
    hasWritableCalendars = false;
    fields.defaultCalendarId.replaceChildren();
    calendarOptionsStatus.textContent = error.message || "Calendriers indisponibles.";
  }
  updateAutoCreateFields();
}

function updateAutoCreateFields() {
  fields.defaultCalendarId.disabled = !fields.autoCreateEvents.checked || !hasWritableCalendars;
}

function updateFolderFields() {
  fields.scanFolders.disabled = fields.scanAllFolders.checked;
  fields.scanFolders.required = !fields.scanAllFolders.checked;
  scanFoldersField.hidden = fields.scanAllFolders.checked;
  fields.indexFolders.disabled = fields.indexAllFolders.checked;
  fields.indexFolders.required = !fields.indexAllFolders.checked;
  indexFoldersField.hidden = fields.indexAllFolders.checked;
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function embeddingSignature(items) {
  const profile = items.find((item) =>
    item.enabled !== false && !["anthropic", "openai-codex"].includes(item.type) && item.embeddingModel
  );
  return profile ? `${profile.type}|${profile.baseUrl}|${profile.embeddingModel}` : "lexical";
}

async function save(event) {
  event.preventDefault();
  try {
    syncCurrentProfile();
    if (!profiles.some((profile) => profile.enabled)) {
      throw new Error("Active au moins un profil LLM.");
    }
    const normalizedProfiles = [];
    for (const profile of profiles) {
      const isCodex = profile.type === "openai-codex";
      if (profile.enabled && !isCodex && !profile.baseUrl.trim()) {
        throw new Error(`L'URL du profil « ${profile.name || "Sans nom"} » est obligatoire.`);
      }
      const normalized = {
        ...profile,
        name: profile.name.trim() || "Sans nom",
        baseUrl: isCodex
          ? "https://chatgpt.com/backend-api/codex"
          : profile.baseUrl.trim() ? normalizeProviderUrl(profile.baseUrl) : "",
        model: profile.model.trim(),
        apiKey: ["ollama", "openai-codex"].includes(profile.type) ? "" : profile.apiKey,
        embeddingModel: ["anthropic", "openai-codex"].includes(profile.type)
          ? ""
          : profile.embeddingModel.trim(),
      };
      if (normalized.enabled && !normalized.model) {
        throw new Error(`Le modele de chat du profil « ${normalized.name} » est obligatoire.`);
      }
      if (normalized.enabled && normalized.type === "anthropic" && !normalized.apiKey) {
        throw new Error(`La cle API du profil « ${normalized.name} » est obligatoire.`);
      }
      normalizedProfiles.push(normalized);
    }
    await requestProviderPermissions(
      normalizedProfiles.filter((profile) => profile.enabled).map((profile) => profile.baseUrl)
    );
    await persistProfileDrafts();

    const previous = await messenger.storage.local.get({ llmProfiles: [] });
    const currentCodexIds = new Set(
      normalizedProfiles.filter((profile) => profile.type === "openai-codex").map((profile) => profile.id)
    );
    for (const previousProfile of previous.llmProfiles || []) {
      if (previousProfile.type === "openai-codex" && !currentCodexIds.has(previousProfile.id)) {
        await messenger.runtime.sendMessage({
          type: "LOGOUT_OPENAI_CODEX",
          profileId: previousProfile.id,
        });
      }
    }
    const providerChanged = embeddingSignature(previous.llmProfiles || []) !== embeddingSignature(normalizedProfiles);
    const [summaryHour, summaryMinute] = fields.summaryTime.value.split(":").map(Number);
    const primary = normalizedProfiles.find(
      (profile) => profile.id === preferredProviderId && profile.enabled
    ) || normalizedProfiles.find((profile) => profile.enabled) || normalizedProfiles[0];
    await messenger.storage.local.set({
      llmProfiles: normalizedProfiles,
      preferredProviderId,
      // Champs historiques conserves pour une retrocompatibilite sans ambiguite.
      llmProvider: primary.type,
      providerBaseUrl: primary.baseUrl,
      providerModel: primary.model,
      apiKey: primary.apiKey,
      embeddingModel: primary.embeddingModel,
      summaryHour,
      summaryMinute,
      autoRefreshMinutes: Number(fields.autoRefreshMinutes.value),
      scanAllFolders: fields.scanAllFolders.checked,
      scanFolders: splitList(fields.scanFolders.value),
      minConfidence: fields.minConfidence.value,
      autoCreateEvents: fields.autoCreateEvents.checked,
      defaultCalendarId: fields.defaultCalendarId.value,
      maxEmailsPerRun: Number(fields.maxEmailsPerRun.value),
      maxBodyChars: Number(fields.maxBodyChars.value),
      dryRun: fields.dryRun.checked,
      indexAllFolders: fields.indexAllFolders.checked,
      indexFolders: splitList(fields.indexFolders.value),
      indexLookbackDays: Number(fields.indexLookbackDays.value),
      indexBatchSize: Number(fields.indexBatchSize.value),
      chatTopK: Number(fields.chatTopK.value),
    });
    profiles = normalizedProfiles;
    await messenger.runtime.sendMessage({ type: "RESCHEDULE_ALARM" });
    if (providerChanged) await messenger.runtime.sendMessage({ type: "CLEAR_MAIL_INDEX" });
    showSaveStatus(
      "success",
      providerChanged ? "Enregistre. Index semantique reinitialise." : "Enregistre."
    );
  } catch (error) {
    showSaveStatus("error", error.message || "Impossible d'enregistrer les options.");
  }
}

function splitList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function showSaveStatus(kind, message) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle("error", kind === "error");
  saveStatus.hidden = false;
  if (kind === "success") setTimeout(() => (saveStatus.hidden = true), 2500);
}

function normalizeProviderUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("L'URL du provider est invalide.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Le provider doit utiliser une URL HTTP(S) sans identifiants integres.");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

function isBuiltInLocalOrigin(url) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
}

async function requestProviderPermission(baseUrl) {
  return requestProviderPermissions([baseUrl]);
}

async function requestProviderPermissions(baseUrls) {
  const origins = [...new Set(
    baseUrls.filter(Boolean)
      .filter((baseUrl) => !isBuiltInLocalOrigin(baseUrl))
      .map((baseUrl) => `${new URL(baseUrl).origin}/*`)
  )];
  if (!origins.length) return;
  const granted = await messenger.permissions.request({
    origins,
    permissions: ["sensitiveDataUpload"],
  });
  if (!granted) throw new Error("Permission d'acces au serveur refusee ; configuration non enregistree.");
}

function showProviderTestStatus(kind, message) {
  providerTestStatus.hidden = false;
  providerTestStatus.className = `connection-status ${kind}`;
  providerTestStatus.textContent = message;
}

function showModelsStatus(kind, message) {
  modelsStatus.hidden = false;
  modelsStatus.className = `connection-status ${kind}`;
  modelsStatus.textContent = message;
}

function editorProfileSettings() {
  syncCurrentProfile();
  const profile = currentProfile();
  return {
    id: profile.id,
    name: profile.name,
    type: profile.type,
    baseUrl: profile.type === "openai-codex"
      ? "https://chatgpt.com/backend-api/codex"
      : normalizeProviderUrl(profile.baseUrl),
    model: profile.model,
    apiKey: profile.apiKey,
  };
}

async function loadProviderModels() {
  if (loadModelsBtn.disabled) return;
  const generation = ++modelsRequestGeneration;
  loadModelsBtn.disabled = true;
  const previousText = loadModelsBtn.textContent;
  loadModelsBtn.textContent = "Chargement...";
  showModelsStatus("loading", "Lecture des modeles...");
  try {
    const settings = editorProfileSettings();
    if (settings.type !== "openai-codex") await requestProviderPermission(settings.baseUrl);
    const result = await messenger.runtime.sendMessage({ type: "LIST_PROVIDER_MODELS", settings });
    if (generation !== modelsRequestGeneration) return;
    if (!result?.ok) {
      showModelsStatus("error", result?.message || "Impossible de recuperer les modeles.");
      return;
    }
    clearProviderModelSelect();
    for (const model of result.models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      providerModelSelect.appendChild(option);
    }
    const currentModel = fields.providerModel.value.trim();
    const missing = currentModel && !result.models.includes(currentModel);
    if (result.models.length) {
      providerModelSelectField.hidden = false;
      providerModelSelect.value = missing ? "" : currentModel;
    }
    showModelsStatus(
      result.models.length ? (missing ? "warning" : "success") : "error",
      result.models.length
        ? `${result.models.length} modele(s) disponible(s). Choisis-en un dans la liste.${missing ? ` Le modele actuel « ${currentModel} » n'est pas annonce.` : ""}`
        : "Le serveur n'a annonce aucun modele."
    );
  } catch (error) {
    if (generation === modelsRequestGeneration) showModelsStatus("error", error.message);
  } finally {
    loadModelsBtn.disabled = false;
    loadModelsBtn.textContent = previousText;
  }
}

async function testProviderConnection() {
  if (testProviderBtn.disabled) return;
  const generation = ++providerTestGeneration;
  testProviderBtn.disabled = true;
  const previousText = testProviderBtn.textContent;
  testProviderBtn.textContent = "Test en cours...";
  showProviderTestStatus("loading", "Connexion au provider...");
  try {
    const settings = editorProfileSettings();
    if (!settings.model) throw new Error("Le modele de chat est obligatoire.");
    await requestProviderPermissions(
      settings.type === "openai-codex"
        ? ["https://auth.openai.com", "https://chatgpt.com"]
        : [settings.baseUrl]
    );
    const result = await messenger.runtime.sendMessage({ type: "TEST_PROVIDER_CONNECTION", settings });
    if (generation !== providerTestGeneration) return;
    showProviderTestStatus(
      result?.ok ? "success" : "error",
      result?.ok
        ? `Connexion reussie au modele ${settings.model} (${result.latencyMs} ms).`
        : result?.message || "Le test du provider a echoue."
    );
  } catch (error) {
    if (generation === providerTestGeneration) showProviderTestStatus("error", error.message);
  } finally {
    testProviderBtn.disabled = false;
    testProviderBtn.textContent = previousText;
  }
}

function invalidateProviderTest() {
  providerTestGeneration++;
  providerTestStatus.hidden = true;
}

function invalidateProviderModels() {
  invalidateProviderTest();
  modelsRequestGeneration++;
  modelsStatus.hidden = true;
  clearProviderModelSelect();
}

function clearProviderModelSelect() {
  providerModelSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choisir un modele...";
  providerModelSelect.appendChild(placeholder);
  providerModelSelectField.hidden = true;
}

function updateProviderFields() {
  const type = fields.llmProvider.value;
  const isOllama = type === "ollama";
  const isAnthropic = type === "anthropic";
  const isCodex = type === "openai-codex";
  providerBaseUrlField.hidden = isCodex;
  apiKeyField.hidden = isOllama || isCodex;
  embeddingModelField.hidden = isAnthropic || isCodex;
  codexAuthField.hidden = !isCodex;
  fields.embeddingModel.disabled = isAnthropic || isCodex;
  providerHint.textContent = isOllama
    ? "Ollama ne demande aucune cle et peut rester entierement local."
    : isCodex
      ? "Connexion OAuth au backend Codex inclus dans les abonnements ChatGPT eligibles. Connecteur experimental : ce backend peut evoluer. Aucun embedding n'est fourni."
    : isAnthropic
      ? "Utilise l'API Anthropic, pas un abonnement Claude grand public. Anthropic ne fournit pas d'embeddings."
      : "Compatible OpenAI, Argo et services similaires. ChatGPT Plus ne fournit pas de cle API : un compte API OpenAI facture separement est necessaire.";
}

function stopCodexStatusPolling() {
  if (codexStatusTimer) clearTimeout(codexStatusTimer);
  codexStatusTimer = null;
}

function renderCodexAuthStatus(status) {
  const connected = status.status === "connected";
  const pending = status.status === "pending";
  codexAuthStatus.className = `connection-status ${
    connected ? "success" : status.status === "error" ? "error" : pending ? "loading" : ""
  }`;
  codexAuthStatus.textContent = connected
    ? `Connecte${status.email ? ` : ${status.email}` : ""}.`
    : pending
      ? "Connexion en attente dans l'onglet OpenAI…"
      : status.status === "error"
        ? status.error || "Connexion ChatGPT impossible."
        : "Non connecte.";
  connectCodexBtn.hidden = connected;
  connectCodexBtn.disabled = pending;
  disconnectCodexBtn.hidden = !connected;
  codexManualCallback.hidden = !pending;
}

async function refreshCodexAuthStatus(scheduleNext = false) {
  stopCodexStatusPolling();
  const profile = currentProfile();
  if (!profile || profile.type !== "openai-codex") return;
  const profileId = profile.id;
  try {
    const status = await messenger.runtime.sendMessage({
      type: "GET_OPENAI_CODEX_AUTH_STATUS",
      profileId,
    });
    if (currentProfile()?.id !== profileId) return;
    renderCodexAuthStatus(status || { status: "disconnected" });
    if (status?.status === "pending" || scheduleNext) {
      codexStatusTimer = setTimeout(() => refreshCodexAuthStatus(), 1200);
    }
  } catch (error) {
    if (currentProfile()?.id === profileId) {
      renderCodexAuthStatus({ status: "error", error: error.message });
    }
  }
}

async function connectOpenAiCodex() {
  const profile = currentProfile();
  if (!profile || profile.type !== "openai-codex") return;
  connectCodexBtn.disabled = true;
  renderCodexAuthStatus({ status: "pending" });
  try {
    // permissions.request doit rester le premier appel asynchrone du clic :
    // Firefox/Thunderbird perd l'activation utilisateur apres le moindre await.
    await requestProviderPermissions(["https://auth.openai.com", "https://chatgpt.com"]);
    // Le jeton OAuth est lie a l'identifiant du profil : celui-ci doit survivre
    // a un rechargement meme si l'utilisateur n'a pas encore valide tout le formulaire.
    await persistProfileDrafts();
    await messenger.runtime.sendMessage({ type: "START_OPENAI_CODEX_AUTH", profileId: profile.id });
    refreshCodexAuthStatus(true);
  } catch (error) {
    renderCodexAuthStatus({ status: "error", error: error.message || "Connexion impossible." });
    connectCodexBtn.disabled = false;
  }
}

async function completeOpenAiCodexManually() {
  const profile = currentProfile();
  if (!profile || profile.type !== "openai-codex") return;
  completeCodexBtn.disabled = true;
  try {
    await persistProfileDrafts();
    const result = await messenger.runtime.sendMessage({
      type: "COMPLETE_OPENAI_CODEX_AUTH",
      profileId: profile.id,
      callbackUrl: codexCallbackUrl.value.trim(),
    });
    codexCallbackUrl.value = "";
    renderCodexAuthStatus(result);
  } catch (error) {
    renderCodexAuthStatus({ status: "error", error: error.message || "Callback OAuth refuse." });
  } finally {
    completeCodexBtn.disabled = false;
  }
}

async function disconnectOpenAiCodex() {
  const profile = currentProfile();
  if (!profile || profile.type !== "openai-codex") return;
  await messenger.runtime.sendMessage({ type: "LOGOUT_OPENAI_CODEX", profileId: profile.id });
  renderCodexAuthStatus({ status: "disconnected" });
}

function handleProviderTypeChange() {
  const profile = currentProfile();
  const defaults = {
    ollama: "http://localhost:11434",
    "openai-compatible": "https://api.openai.com/v1",
    "openai-codex": "https://chatgpt.com/backend-api/codex",
    anthropic: "https://api.anthropic.com",
  };
  const knownDefaults = new Set(Object.values(defaults));
  if (!profile.baseUrl || knownDefaults.has(profile.baseUrl)) fields.providerBaseUrl.value = defaults[fields.llmProvider.value];
  if (fields.llmProvider.value === "ollama" && !fields.embeddingModel.value) {
    fields.embeddingModel.value = "nomic-embed-text";
  }
  syncCurrentProfile();
  updateProviderFields();
  refreshCodexAuthStatus();
  invalidateProviderModels();
  persistProfileDraftsSilently();
}

form.addEventListener("submit", save);
addProviderBtn.addEventListener("click", addProvider);
deleteProviderBtn.addEventListener("click", deleteProvider);
moveProviderLeftBtn.addEventListener("click", () => moveProvider(-1));
moveProviderRightBtn.addEventListener("click", () => moveProvider(1));
fields.llmProvider.addEventListener("change", handleProviderTypeChange);
preferredProviderSelect.addEventListener("change", () => {
  preferredProviderId = preferredProviderSelect.value;
  persistProfileDraftsSilently();
});
fields.providerEnabled.addEventListener("change", () => {
  syncCurrentProfile();
  persistProfileDraftsSilently();
});
fields.providerName.addEventListener("input", () => {
  syncCurrentProfile();
  scheduleProfileDraftSave();
});
fields.providerName.addEventListener("change", persistProfileDraftsSilently);
[fields.providerBaseUrl, fields.apiKey].forEach((field) => {
  field.addEventListener("input", () => {
    syncCurrentProfile();
    invalidateProviderModels();
    scheduleProfileDraftSave();
  });
  field.addEventListener("change", persistProfileDraftsSilently);
});
[fields.providerModel, fields.embeddingModel].forEach((field) => {
  field.addEventListener("input", () => {
    syncCurrentProfile();
    invalidateProviderTest();
    scheduleProfileDraftSave();
  });
  field.addEventListener("change", persistProfileDraftsSilently);
});
providerModelSelect.addEventListener("change", async () => {
  if (!providerModelSelect.value) return;
  fields.providerModel.value = providerModelSelect.value;
  syncCurrentProfile();
  invalidateProviderTest();
  try {
    await persistProfileDrafts();
    showModelsStatus("success", `Modele « ${providerModelSelect.value} » selectionne et profil sauvegarde.`);
  } catch (error) {
    showModelsStatus("error", error.message || "Impossible de sauvegarder le profil.");
  }
});
testProviderBtn.addEventListener("click", testProviderConnection);
loadModelsBtn.addEventListener("click", loadProviderModels);
connectCodexBtn.addEventListener("click", connectOpenAiCodex);
disconnectCodexBtn.addEventListener("click", disconnectOpenAiCodex);
completeCodexBtn.addEventListener("click", completeOpenAiCodexManually);
fields.autoCreateEvents.addEventListener("change", updateAutoCreateFields);
fields.scanAllFolders.addEventListener("change", updateFolderFields);
fields.indexAllFolders.addEventListener("change", updateFolderFields);
load().catch((error) => showSaveStatus("error", error.message || "Impossible de charger les options."));
