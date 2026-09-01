// File des ecritures proposees mais pas encore validees.
//
// Regle de l'extension : rien n'est ecrit dans les donnees de l'utilisateur
// sans son accord, sauf s'il a explicitement active l'automatisme. Le modele
// peut donc proposer un evenement, jamais l'imposer.

import { AppError, toAppError } from "../core/errors.js";
import { createLogger } from "../core/logger.js";
import { read, write } from "../core/storage.js";
import { createEvent } from "../calendar/repository.js";

const logger = createLogger("writes");

const STATE_KEY = "pendingWrites";
const MAX_ENTRIES = 200;

export const WRITE_STATUS = Object.freeze({
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  failed: "failed",
});

// Les propositions arrivent souvent en rafale (fin de scan, reponse de chat).
// Sans serialisation, deux ecritures concurrentes relisent la meme liste et la
// derniere ecrase silencieusement l'autre.
let chain = Promise.resolve();

function serialize(task) {
  const run = chain.then(task, task);
  chain = run.then(() => {}, () => {});
  return run;
}

async function readAll() {
  return (await read(STATE_KEY, [])) || [];
}

/** Enregistre une proposition et renvoie son identifiant. */
export function queueWrite({ type, event, source = "chat" }) {
  return serialize(async () => {
    const entries = await readAll();
    const entry = {
      id: `write-${crypto.randomUUID()}`,
      type,
      payload: event,
      source,
      status: WRITE_STATUS.pending,
      createdAt: new Date().toISOString(),
    };
    await write(STATE_KEY, [...entries, entry].slice(-MAX_ENTRIES));
    logger.info("Ecriture proposee", { type, source });
    return entry;
  });
}

export async function listPendingWrites({ status = WRITE_STATUS.pending } = {}) {
  const entries = await readAll();
  return status ? entries.filter((entry) => entry.status === status) : entries;
}

function updateEntry(id, patch) {
  return serialize(async () => {
    const entries = await readAll();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new AppError("Proposition introuvable.", { code: "configuration" });
    entries[index] = { ...entries[index], ...patch, updatedAt: new Date().toISOString() };
    await write(STATE_KEY, entries);
    return entries[index];
  });
}

const EXECUTORS = {
  async create_event(payload, { calendarId }) {
    return createEvent(payload, { calendarId });
  },
};

/** Valide une proposition et l'execute reellement. */
export async function approveWrite(id, { calendarId = "" } = {}) {
  const entries = await readAll();
  const entry = entries.find((item) => item.id === id);
  if (!entry) throw new AppError("Proposition introuvable.", { code: "configuration" });
  if (entry.status !== WRITE_STATUS.pending) return entry;

  const executor = EXECUTORS[entry.type];
  if (!executor) {
    return updateEntry(id, { status: WRITE_STATUS.failed, error: `Type inconnu : ${entry.type}` });
  }
  try {
    const result = await executor(entry.payload, { calendarId });
    return await updateEntry(id, { status: WRITE_STATUS.approved, result });
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("Ecriture refusee par l'hote", { type: entry.type, code: appError.code });
    return updateEntry(id, { status: WRITE_STATUS.failed, error: appError.message });
  }
}

export function rejectWrite(id) {
  return updateEntry(id, { status: WRITE_STATUS.rejected });
}

/** Purge les propositions traitees, pour ne pas laisser grossir le stockage. */
export function clearResolvedWrites() {
  return serialize(async () => {
    const entries = await readAll();
    await write(STATE_KEY, entries.filter((entry) => entry.status === WRITE_STATUS.pending));
  });
}
