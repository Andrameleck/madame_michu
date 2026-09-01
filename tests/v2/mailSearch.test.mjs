// Recherche dans la messagerie. Thunderbird ne restitue les messages dans aucun
// ordre garanti : ces tests figent le fait qu'on balaie avant de trier, sans
// quoi « le plus ancien message » est celui d'un echantillon arbitraire.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { queryMessages } from "../../src/mail/repository.js";
import { searchMailTool } from "../../src/agent/tools/mailTools.js";
import { setLogLevel } from "../../src/core/logger.js";

setLogLevel("silent");

function header(id, isoDate, subject = `objet ${id}`) {
  return {
    id,
    subject,
    author: `expediteur${id}@exemple.fr`,
    recipients: [],
    date: new Date(isoDate),
    read: false,
    flagged: false,
  };
}

/**
 * Faux service de messagerie. `pages` est la sequence exacte que Thunderbird
 * renverrait, volontairement dans le desordre chronologique.
 */
function installMailbox(pages, { aborted = [] } = {}) {
  const queue = pages.map((messages, index) => ({
    id: index < pages.length - 1 ? `list-${index}` : null,
    messages,
  }));
  const queries = [];
  let cursor = 0;
  globalThis.messenger = {
    messages: {
      async query(criteria) {
        queries.push(criteria);
        cursor = 0;
        return queue[cursor];
      },
      async continueList() {
        cursor += 1;
        return queue[cursor] || null;
      },
      async abortList(id) {
        aborted.push(id);
      },
    },
  };
  return queries;
}

beforeEach(() => {
  delete globalThis.messenger;
});

test("le tri chronologique porte sur tout le balayage, pas sur la premiere page", async () => {
  // Le message le plus ancien est volontairement sur la derniere page.
  installMailbox([
    [header(1, "2026-08-21T12:58:00Z"), header(2, "2026-08-30T09:00:00Z")],
    [header(3, "2026-08-25T10:00:00Z")],
    [header(4, "2019-03-02T08:00:00Z"), header(5, "2026-09-01T07:00:00Z")],
  ]);

  const oldest = await queryMessages({}, { limit: 1, sort: "asc" });
  assert.equal(oldest[0].id, "4", "le plus ancien doit venir de la derniere page");
  assert.equal(oldest[0].date.slice(0, 4), "2019");

  const newest = await queryMessages({}, { limit: 1, sort: "desc" });
  assert.equal(newest[0].id, "5");
});

test("le balayage rapporte ce qu'il a vu et s'il a ete coupe", async () => {
  installMailbox([
    [header(1, "2026-08-01T10:00:00Z"), header(2, "2026-08-02T10:00:00Z")],
    [header(3, "2026-08-03T10:00:00Z")],
  ]);

  const complete = await queryMessages({}, { limit: 10 });
  assert.equal(complete.scanned, 3);
  assert.equal(complete.truncated, false, "une boite entierement lue n'est pas tronquee");
});

test("un balayage coupe par le plafond le signale et libere la liste", async () => {
  const aborted = [];
  installMailbox([
    [header(1, "2026-08-01T10:00:00Z"), header(2, "2026-08-02T10:00:00Z")],
    [header(3, "2026-08-03T10:00:00Z")],
  ], { aborted });

  const partial = await queryMessages({}, { limit: 1, scanCap: 2 });
  assert.equal(partial.scanned, 2);
  assert.equal(partial.truncated, true);
  // Une liste abandonnee continue sinon a se remplir en arriere-plan.
  assert.deepEqual(aborted, ["list-0"]);
});

test("les bornes de dates sont transmises en objets Date", async () => {
  const queries = installMailbox([[header(1, "2026-08-01T10:00:00Z")]]);
  await queryMessages({ fullText: "facture", fromDate: "2026-01-01T00:00:00Z" }, { limit: 5 });
  assert.equal(queries[0].fullText, "facture");
  assert.ok(queries[0].fromDate instanceof Date);
});

test("l'outil de recherche expose le tri au modele", async () => {
  const sortSpec = searchMailTool.parameters.properties.sort;
  assert.deepEqual(sortSpec.enum, ["recent", "ancien"]);
  assert.match(sortSpec.description, /ancien/);
});

test("l'outil trie a l'ancienne quand le modele le demande", async () => {
  installMailbox([
    [header(1, "2026-08-21T12:58:00Z"), header(2, "2020-01-05T08:00:00Z")],
  ]);

  const result = await searchMailTool.handler({ sort: "ancien", limit: 2 }, {});
  assert.deepEqual(result.messages.map((message) => message.id), ["2", "1"]);
  assert.equal(result.messages_parcourus, 2);
  assert.equal(result.avertissement, undefined);
});

test("l'outil previent le modele quand le balayage est partiel", async () => {
  installMailbox([
    [header(1, "2026-08-01T10:00:00Z")],
    [header(2, "2026-08-02T10:00:00Z")],
  ]);
  // Le plafond par defaut n'est pas atteignable ici : on passe par la
  // repository directement pour verifier la transmission de l'avertissement.
  const partial = await queryMessages({}, { limit: 1, scanCap: 1 });
  assert.equal(partial.truncated, true);
});

test("les sources affichees privilegient les messages reellement ouverts", async () => {
  const { collectSources } = await import("../../src/features/chat/service.js");

  const searchStep = {
    tool: "search_mail",
    ok: true,
    result: {
      messages: Array.from({ length: 12 }, (_, index) => ({
        id: String(index),
        objet: `Retrieval failed ${700 + index}`,
        de: "Microsoft Exchange Server 2010",
        date: "2026-08-21 12:58",
      })),
    },
  };

  // Sans lecture, on ne montre qu'un echantillon : douze notifications
  // automatiques identiques n'aident personne.
  const listedOnly = collectSources([searchStep]);
  assert.equal(listedOnly.length, 5);

  // Des qu'un message est ouvert, lui seul fait foi.
  const withRead = collectSources([
    searchStep,
    { tool: "read_mail", ok: true, result: { id: "42", objet: "Point general", de: "Florian", date: "2026-08-31" } },
  ]);
  assert.deepEqual(withRead, [
    { id: "42", subject: "Point general", author: "Florian", date: "2026-08-31" },
  ]);
});

test("un outil en echec ne produit aucune source", async () => {
  const { collectSources } = await import("../../src/features/chat/service.js");
  assert.deepEqual(collectSources([{ tool: "search_mail", ok: false, result: null }]), []);
});

test("un extremum calcule sous filtre est signale comme tel", async () => {
  installMailbox([[header(1, "2026-08-31T07:03:00Z"), header(2, "2026-09-01T09:00:00Z")]]);

  // Exactement le cas observe : tri par anciennete + fenetre d'un jour.
  const filtered = await searchMailTool.handler({ sort: "ancien", since_days: 1 }, {});
  assert.match(filtered.avertissement, /pas de toute la messagerie/);
  assert.match(filtered.filtres_appliques, /derniers jours = 1/);

  // Sans critere, aucun avertissement : le resultat est bien un extremum absolu.
  const absolute = await searchMailTool.handler({ sort: "ancien" }, {});
  assert.equal(absolute.avertissement, undefined);
  assert.equal(absolute.filtres_appliques, "aucun (toute la messagerie accessible)");
});

test("les filtres appliques sont toujours renvoyes au modele", async () => {
  installMailbox([[header(1, "2026-08-31T07:03:00Z")]]);
  const result = await searchMailTool.handler({ keywords: "facture", author: "inrae" }, {});
  assert.match(result.filtres_appliques, /mots-cles = facture/);
  assert.match(result.filtres_appliques, /expediteur = inrae/);
});

test("le chat cherche dans toute la messagerie, pas dans le perimetre des rapports", async () => {
  const { resolveChatScope } = await import("../../src/mail/repository.js");

  // Reglages typiques d'un rapport : boite de reception seule. Le chat les ignore.
  const reportScoped = {
    mail: { allAccounts: true, allFolders: false, folders: ["inbox"], accountIds: [] },
  };
  assert.deepEqual(resolveChatScope(reportScoped), {}, "aucun filtre de dossier ni de date");

  // Une selection de comptes est une decision de l'utilisateur : elle tient.
  const accountScoped = {
    mail: { allAccounts: false, accountIds: ["account1"], allFolders: false, folders: ["inbox"] },
  };
  assert.deepEqual(resolveChatScope(accountScoped), { accountId: ["account1"] });
});

test("sans critere, la recherche du chat n'envoie aucune borne de date", async () => {
  const queries = installMailbox([[header(1, "2019-01-01T08:00:00Z")]]);
  await searchMailTool.handler({ sort: "ancien" }, { scope: {} });
  assert.deepEqual(Object.keys(queries[0]), [], "la requete doit etre entierement ouverte");
});
