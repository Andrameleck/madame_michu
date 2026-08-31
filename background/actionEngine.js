// Moteur d'actions : proposition -> confirmation -> execution -> journal.
// Seules les nouvelles capacites (brouillon, tache, mise a jour d'un evenement
// existant) passent par ce moteur. Le reste de l'extension (rapports, chat,
// creation automatique des rendez-vous detectes) continue d'ecrire directement,
// comme avant : ce moteur n'est pas une remise a plat, seulement une couche de
// confirmation pour les ecritures qui n'existaient pas encore.

const ACTION_RISK = Object.freeze({ READ: "read", WRITE: "write", DESTRUCTIVE: "destructive" });
const ACTION_STATUS = Object.freeze({
  PROPOSED: "proposed",
  APPROVED: "approved",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  REJECTED: "rejected",
});

const actionTools = new Map();

function registerActionTool(definition) {
  if (!definition?.name || typeof definition.execute !== "function") {
    throw new Error("Definition d'outil invalide.");
  }
  if (actionTools.has(definition.name)) {
    throw new Error(`Outil deja enregistre : ${definition.name}`);
  }
  actionTools.set(definition.name, Object.freeze({ risk: ACTION_RISK.READ, ...definition }));
}

function getActionTool(name) {
  const tool = actionTools.get(name);
  if (!tool) throw new Error(`Outil inconnu : ${name}`);
  return tool;
}

function describeActionTools() {
  return [...actionTools.values()].map(({ name, description, risk }) => ({ name, description, risk }));
}

function newActionId(prefix = "action") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function proposeAction(toolName, args = {}, context = {}) {
  const tool = getActionTool(toolName);
  const settings = await getSettings();
  const action = {
    id: newActionId(),
    tool: tool.name,
    description: tool.description,
    risk: tool.risk,
    args,
    origin: context.origin || "unknown",
    status: ACTION_STATUS.PROPOSED,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await appendAction(action);
  const mustConfirm = tool.risk !== ACTION_RISK.READ && settings.confirmWrites && !context.preapproved;
  return mustConfirm ? action : executeAction(action.id);
}

async function executeAction(actionId) {
  const actions = await getActions();
  const action = actions.find((item) => item.id === actionId);
  if (!action) throw new Error("Action inconnue.");
  if (![ACTION_STATUS.PROPOSED, ACTION_STATUS.APPROVED].includes(action.status)) {
    throw new Error("Cette action n'est plus executable.");
  }
  await updateActionRecord(actionId, { status: ACTION_STATUS.RUNNING });
  try {
    const result = await getActionTool(action.tool).execute(action.args);
    return updateActionRecord(actionId, {
      status: ACTION_STATUS.SUCCEEDED,
      result,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    await updateActionRecord(actionId, {
      status: ACTION_STATUS.FAILED,
      error: error?.message || "L'action a echoue.",
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }
}

async function approveAction(actionId) {
  await updateActionRecord(actionId, { status: ACTION_STATUS.APPROVED });
  return executeAction(actionId);
}

function rejectAction(actionId) {
  return updateActionRecord(actionId, { status: ACTION_STATUS.REJECTED });
}

async function listActions({ status, limit = 100 } = {}) {
  const actions = await getActions();
  return actions.filter((item) => !status || item.status === status).slice(-limit).reverse();
}

// -----------------------------------------------------------------------------
// Outils enregistres. Uniquement les capacites qui n'existaient pas avant ce
// moteur : rapports, chat, meteo, actus et creation auto d'evenements gardent
// leur chemin d'ecriture direct, inchange.
// -----------------------------------------------------------------------------

async function createMailDraft({ identityId, to = [], cc = [], bcc = [], subject = "", body = "" }) {
  if (!to.length) throw new Error("Un destinataire est obligatoire.");
  const tab = await messenger.compose.beginNew(undefined, {
    identityId: identityId || undefined,
    to,
    cc,
    bcc,
    subject: String(subject || "").slice(0, 500),
    plainTextBody: String(body || "").slice(0, 100_000),
    isPlainText: true,
  });
  const saved = await messenger.compose.saveMessage(tab.id, { mode: "draft" });
  await messenger.tabs.remove(tab.id).catch(() => {});
  const message = saved.messages?.[0];
  return {
    id: message?.id,
    headerMessageId: message?.headerMessageId || "",
    subject: message?.subject || subject,
    folder: message?.folder?.path || "",
  };
}

registerActionTool({
  name: "mail.create_draft",
  description: "Creer et enregistrer un brouillon",
  risk: ACTION_RISK.WRITE,
  execute: createMailDraft,
});

registerActionTool({
  name: "task.list",
  description: "Lister les taches Lightning",
  risk: ACTION_RISK.READ,
  execute: (args) => listTasks(args?.calendarId, args),
});

registerActionTool({
  name: "task.create",
  description: "Creer une tache",
  risk: ACTION_RISK.WRITE,
  execute: (args) => createTask(args),
});

registerActionTool({
  name: "calendar.update_item",
  description: "Modifier un evenement ou une tache existante",
  risk: ACTION_RISK.WRITE,
  execute: (args) => updateCalendarItem(args.calendarId, args.itemId, args.changes || {}),
});

registerActionTool({
  name: "calendar.list_events",
  description: "Lister les evenements a venir (pour selection/modification)",
  risk: ACTION_RISK.READ,
  execute: (args) => getUpcomingCalendarEvents(args),
});
