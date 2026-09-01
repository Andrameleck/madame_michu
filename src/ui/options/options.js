// Page de reglages. Onglets de profils et editeur, comme en version 1, mais le
// formulaire d'un profil n'est plus ecrit en dur : il est engendre a partir des
// champs declares par le fournisseur dans le registre. Ajouter un fournisseur
// ne demande donc aucune modification ici.

import { call } from "../../core/messaging.js";
import { hasOriginPermission, originPattern, requestOriginPermission } from "../../core/permissions.js";
import { clear, el, replace } from "../shared/dom.js";
import { applyTranslations, setLanguage, t } from "../shared/i18n.js";

const tabsNode = document.getElementById("providerTabs");
const editorNode = document.getElementById("providerEditor");
const saveStatus = document.getElementById("saveStatus");

const state = {
  config: null,
  providers: [],
  accounts: [],
  calendars: [],
  secrets: new Map(), // profileId -> { apiKey: bool, oauth: bool }
  selected: 0,
};

function providerById(id) {
  return state.providers.find((provider) => provider.id === id);
}

function profiles() {
  return state.config.llm.profiles;
}

function showStatus(message, tone = "success") {
  saveStatus.textContent = message;
  saveStatus.className = `save-status${tone === "error" ? " error" : ""}`;
  saveStatus.hidden = false;
  if (tone !== "error") setTimeout(() => { saveStatus.hidden = true; }, 5000);
}

// -----------------------------------------------------------------------------
// Onglets de profils
// -----------------------------------------------------------------------------

function renderTabs() {
  replace(tabsNode, profiles().map((profile, index) =>
    el("button", {
      type: "button",
      role: "tab",
      class: `provider-tab secondary${profile.enabled === false ? " disabled-profile" : ""}`,
      "aria-selected": String(index === state.selected),
      text: `${index + 1}. ${profile.label || t("options.provider.name")}`,
      onclick: () => {
        state.selected = index;
        renderTabs();
        renderEditor();
      },
    })
  ));
  if (!profiles().length) {
    tabsNode.append(el("p", { class: "hint", text: t("options.providers.empty") }));
  }
}

// -----------------------------------------------------------------------------
// Editeur du profil selectionne
// -----------------------------------------------------------------------------

function renderEditor() {
  const profile = profiles()[state.selected];
  clear(editorNode);
  if (!profile) return;

  const descriptor = providerById(profile.provider) || state.providers[0];

  const modelSelect = el("select", {
    onchange: (event) => { profile.model = event.target.value; },
  });
  fillModelSelect(modelSelect, [], profile.model);

  const loadButton = el("button", {
    type: "button",
    class: "secondary",
    text: t("options.provider.loadModels"),
    onclick: () => loadModels(profile, modelSelect, loadButton),
  });

  editorNode.append(
    el("div", { class: "provider-editor-actions" },
      el("button", {
        type: "button", class: "secondary", text: "▲",
        title: t("options.provider.up"), "aria-label": t("options.provider.up"),
        disabled: state.selected === 0,
        onclick: () => moveProfile(-1),
      }),
      el("button", {
        type: "button", class: "secondary", text: "▼",
        title: t("options.provider.down"), "aria-label": t("options.provider.down"),
        disabled: state.selected === profiles().length - 1,
        onclick: () => moveProfile(1),
      }),
      el("button", {
        type: "button", class: "danger", text: t("options.provider.delete"),
        onclick: () => removeProfile(),
      })
    ),

    el("label", { class: "checkbox" },
      el("input", {
        type: "checkbox",
        checked: profile.enabled !== false,
        onchange: (event) => {
          profile.enabled = event.target.checked;
          renderTabs();
        },
      }),
      el("span", { text: t("options.provider.enabled") })
    ),

    el("label", {},
      el("span", { text: t("options.provider.name") }),
      el("input", {
        type: "text",
        value: profile.label || "",
        oninput: (event) => {
          profile.label = event.target.value;
          renderTabs();
        },
      })
    ),

    el("label", {},
      el("span", { text: t("options.provider.type") }),
      buildProviderSelect(profile)
    ),

    ...descriptor.fields.map((spec) => renderField(profile, descriptor, spec, { modelSelect, loadButton })),

    el("p", { class: "hint provider-hint", text: descriptor.description }),

    el("div", { class: "provider-test" },
      el("button", {
        type: "button",
        text: t("options.provider.test"),
        onclick: (event) => testProfile(profile, event.target),
      })
    )
  );
}

function buildProviderSelect(profile) {
  const node = el("select", {
    onchange: (event) => changeProvider(profile, event.target.value),
  });
  for (const provider of state.providers) {
    node.append(el("option", { value: provider.id, text: provider.label }));
  }
  node.value = profile.provider;
  return node;
}

function renderField(profile, descriptor, spec, controls) {
  if (spec.type === "model") {
    return el("div", { class: "provider-models-action provider-wide" },
      controls.modelSelect,
      controls.loadButton
    );
  }
  if (spec.type === "oauth") {
    return renderOAuth(profile);
  }
  if (spec.key === "baseUrl" && descriptor.fixedBaseUrl) return null;
  if (spec.type === "password") {
    const stored = state.secrets.get(profile.id)?.apiKey;
    return el("label", {},
      el("span", { text: spec.label }),
      el("input", {
        type: "password",
        autocomplete: "new-password",
        placeholder: stored ? t("options.provider.keyStored") : t("options.provider.keyPlaceholder"),
        onchange: (event) => saveSecret(profile, event.target),
      }),
      stored ? el("span", { class: "hint", text: t("options.provider.keySaved") }) : null
    );
  }
  return el("label", {},
    el("span", { text: spec.label }),
    el("input", {
      type: "text",
      value: profile[spec.key] ?? "",
      placeholder: spec.placeholder || "",
      oninput: (event) => { profile[spec.key] = event.target.value; },
    })
  );
}

function renderOAuth(profile) {
  const connected = state.secrets.get(profile.id)?.oauth;
  const badge = el("span", {
    class: `connection-status${connected ? " success" : ""}`,
    text: t(connected ? "options.provider.connected" : "options.provider.disconnected"),
  });
  return el("div", { class: "oauth-box provider-wide" },
    el("div", { class: "oauth-row" },
      el("button", {
        type: "button",
        text: t(connected ? "options.provider.reconnect" : "options.provider.connect"),
        onclick: () => connectChatGpt(profile, badge),
      }),
      badge
    )
  );
}

async function connectChatGpt(profile, badge) {
  try {
    await call("chatgpt.connect", { profileId: profile.id });
    badge.textContent = "…";
    // Le background termine l'echange en observant l'onglet ouvert : on
    // interroge le statut jusqu'a ce qu'il bascule.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const result = await call("chatgpt.status", { profileId: profile.id });
      if (result.status === "connected") {
        state.secrets.set(profile.id, { ...state.secrets.get(profile.id), oauth: true });
        badge.textContent = result.email || t("options.provider.connected");
        badge.className = "connection-status success";
        return;
      }
      if (result.status === "error") {
        badge.textContent = result.error || "✕";
        badge.className = "connection-status error";
        return;
      }
    }
    badge.className = "connection-status warning";
    badge.textContent = t("options.provider.disconnected");
  } catch (error) {
    badge.textContent = error.message;
    badge.className = "connection-status error";
  }
}

async function saveSecret(profile, input) {
  const apiKey = input.value.trim();
  if (!apiKey) return;
  await call("llm.setSecret", { profileId: profile.id, apiKey });
  state.secrets.set(profile.id, { ...state.secrets.get(profile.id), apiKey: true });
  input.value = "";
  input.placeholder = t("options.provider.keyStored");
  showStatus(t("options.saved"));
}

function changeProvider(profile, providerId) {
  const previous = providerById(profile.provider);
  const descriptor = providerById(providerId);
  // Un nom laisse par defaut suit le fournisseur ; un nom choisi est conserve.
  if (!profile.label || profile.label === previous?.label) profile.label = descriptor.label;
  profile.provider = providerId;
  profile.baseUrl = descriptor.defaultBaseUrl;
  profile.model = "";
  renderTabs();
  renderEditor();
}

function moveProfile(delta) {
  const list = profiles();
  const target = state.selected + delta;
  if (target < 0 || target >= list.length) return;
  [list[state.selected], list[target]] = [list[target], list[state.selected]];
  state.selected = target;
  renderTabs();
  renderEditor();
}

async function removeProfile() {
  const [removed] = profiles().splice(state.selected, 1);
  if (removed) {
    await call("llm.forgetSecret", { profileId: removed.id }).catch(() => {});
    state.secrets.delete(removed.id);
  }
  state.selected = Math.max(0, state.selected - 1);
  renderTabs();
  renderEditor();
}

function fillModelSelect(node, models, current) {
  clear(node);
  const list = [...new Set([...(current ? [current] : []), ...models])].filter(Boolean);
  if (!list.length) node.append(el("option", { value: "", text: t("options.provider.loadModels") }));
  for (const model of list) node.append(el("option", { value: model, text: model }));
  node.value = current || list[0] || "";
}

async function loadModels(profile, node, button) {
  button.disabled = true;
  button.textContent = t("options.provider.loading");
  try {
    await ensurePermission(profile);
    const models = await call("llm.listModels", { profile });
    fillModelSelect(node, models, profile.model);
    profile.model = node.value;
    showStatus(`${models.length} ✓`);
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = t("options.provider.loadModels");
  }
}

/**
 * Reclame l'autorisation de contacter un service distant. Doit partir d'un clic :
 * Thunderbird ignore une demande de permission hors interaction utilisateur.
 */
async function ensurePermission(profile) {
  const descriptor = providerById(profile.provider);
  const endpoint = descriptor.fixedBaseUrl ? descriptor.defaultBaseUrl : profile.baseUrl;
  if (!descriptor.remote || !endpoint) return true;
  if (await hasOriginPermission(endpoint)) return true;
  const granted = await requestOriginPermission(endpoint);
  if (!granted) showStatus(`${originPattern(endpoint)} ✕`, "error");
  return granted;
}

async function testProfile(profile, button) {
  button.disabled = true;
  button.textContent = t("options.provider.testing");
  try {
    await ensurePermission(profile);
    const result = await call("llm.test", { profile });
    if (result.ok) showStatus(`✓ ${result.model} — ${result.latencyMs} ms`);
    else showStatus(result.message, "error");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = t("options.provider.test");
  }
}

// -----------------------------------------------------------------------------
// Reste du formulaire
// -----------------------------------------------------------------------------

const fields = {
  allowRemote: document.getElementById("allowRemote"),
  allAccounts: document.getElementById("allAccounts"),
  allFolders: document.getElementById("allFolders"),
  maxMessages: document.getElementById("maxMessages"),
  maxBodyChars: document.getElementById("maxBodyChars"),
  reportTime: document.getElementById("reportTime"),
  autoRefresh: document.getElementById("autoRefresh"),
  language: document.getElementById("language"),
  calendarId: document.getElementById("calendarId"),
  minConfidence: document.getElementById("minConfidence"),
  confirmBeforeWrite: document.getElementById("confirmBeforeWrite"),
  autoCreate: document.getElementById("autoCreate"),
};

function renderAccounts() {
  document.getElementById("accountsField").hidden = fields.allAccounts.checked;
  replace(document.getElementById("accountsList"), state.accounts.map((account) =>
    el("label", { class: "checkbox" },
      el("input", {
        type: "checkbox",
        checked: state.config.mail.accountIds.includes(account.id),
        onchange: (event) => {
          const set = new Set(state.config.mail.accountIds);
          if (event.target.checked) set.add(account.id);
          else set.delete(account.id);
          state.config.mail.accountIds = [...set];
        },
      }),
      el("span", { text: `${account.name} (${account.type})` })
    )
  ));
}

function fillForm() {
  const config = state.config;
  fields.allowRemote.checked = config.privacy.allowRemoteProviders;
  fields.allAccounts.checked = config.mail.allAccounts;
  fields.allFolders.checked = config.mail.allFolders;
  fields.maxMessages.value = config.mail.maxMessagesPerRun;
  fields.maxBodyChars.value = config.mail.maxBodyChars;
  fields.reportTime.value =
    `${String(config.reports.hour).padStart(2, "0")}:${String(config.reports.minute).padStart(2, "0")}`;
  fields.autoRefresh.value = String(config.reports.autoRefreshMinutes);
  fields.language.value = config.language;
  fields.minConfidence.value = config.calendar.minConfidence;
  fields.confirmBeforeWrite.checked = config.calendar.confirmBeforeWrite;
  fields.autoCreate.checked = config.calendar.autoCreate;

  clear(fields.calendarId);
  fields.calendarId.append(el("option", { value: "", text: t("events.calendarDefault") }));
  for (const calendar of state.calendars) {
    fields.calendarId.append(el("option", {
      value: calendar.id,
      text: calendar.name + (calendar.readOnly ? " (r/o)" : ""),
    }));
  }
  fields.calendarId.value = config.calendar.calendarId || "";
}

function collectForm() {
  const [hour, minute] = fields.reportTime.value.split(":").map(Number);
  return {
    language: fields.language.value,
    llm: { profiles: profiles() },
    privacy: { allowRemoteProviders: fields.allowRemote.checked },
    mail: {
      allAccounts: fields.allAccounts.checked,
      accountIds: state.config.mail.accountIds,
      allFolders: fields.allFolders.checked,
      folders: state.config.mail.folders,
      maxMessagesPerRun: Number(fields.maxMessages.value) || 200,
      maxBodyChars: Number(fields.maxBodyChars.value) || 4000,
    },
    reports: {
      hour: Number.isFinite(hour) ? hour : 8,
      minute: Number.isFinite(minute) ? minute : 0,
      autoRefreshMinutes: Number(fields.autoRefresh.value),
    },
    calendar: {
      calendarId: fields.calendarId.value,
      minConfidence: fields.minConfidence.value,
      confirmBeforeWrite: fields.confirmBeforeWrite.checked,
      autoCreate: fields.autoCreate.checked,
    },
  };
}

async function save() {
  const button = document.getElementById("saveBtn");
  button.disabled = true;
  try {
    // Le clic sur « Enregistrer » est le geste utilisateur qui autorise la
    // demande de permission pour chaque service distant nouvellement actif.
    for (const profile of profiles().filter((item) => item.enabled !== false)) {
      await ensurePermission(profile);
    }
    state.config = await call("config.save", { patch: collectForm() });
    setLanguage(state.config.language);
    applyTranslations();
    renderTabs();
    renderEditor();
    showStatus(t("options.saved"));
  } catch (error) {
    // Un profil incomplet remonte ici avec un message explicite.
    showStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

// -----------------------------------------------------------------------------
// Demarrage
// -----------------------------------------------------------------------------

document.getElementById("addProfileBtn").addEventListener("click", () => {
  const descriptor = state.providers[0];
  profiles().push({
    id: `profile-${crypto.randomUUID()}`,
    label: descriptor.label,
    provider: descriptor.id,
    model: "",
    baseUrl: descriptor.defaultBaseUrl,
    enabled: true,
    options: {},
  });
  state.selected = profiles().length - 1;
  renderTabs();
  renderEditor();
});

document.getElementById("saveBtn").addEventListener("click", save);
fields.allAccounts.addEventListener("change", renderAccounts);
fields.language.addEventListener("change", (event) => {
  setLanguage(event.target.value);
  applyTranslations();
  renderTabs();
  renderEditor();
});

async function boot() {
  try {
    const snapshot = await call("config.get");
    state.config = snapshot.config;
    state.providers = snapshot.providers;
    setLanguage(snapshot.config.language);
    applyTranslations();
    document.getElementById("calendarUnavailable").hidden = snapshot.calendarAvailable;

    const [accounts, calendars] = await Promise.all([
      call("mail.accounts").catch(() => []),
      snapshot.calendarAvailable ? call("calendar.list").catch(() => []) : [],
    ]);
    state.accounts = accounts;
    state.calendars = calendars;

    await Promise.all(profiles().map(async (profile) => {
      state.secrets.set(profile.id, await call("llm.hasSecret", { profileId: profile.id }));
    }));

    fillForm();
    renderAccounts();
    renderTabs();
    renderEditor();
  } catch (error) {
    showStatus(error.message, "error");
  }
}

boot();
