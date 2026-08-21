const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Au premier lancement, la page d'arriere-plan MV3 peut ne pas etre joignable au
// moment ou la sidebar envoie ses premiers messages : le rapport automatique
// echouait alors sur "Receiving end does not exist" alors que le bouton manuel,
// declenche plus tard, fonctionnait.
function loadMessaging(sendMessage) {
  const attempts = [];
  const waits = [];
  const context = vm.createContext({
    // Les attentes sont enregistrees plutot que subies : le test verifie la
    // sequence de renvois, pas l'horloge.
    setTimeout: (fn, ms) => {
      waits.push(ms);
      return setTimeout(fn, 0);
    },
    clearTimeout,
    Promise,
    Date,
    Math,
    messenger: {
      runtime: {
        sendMessage: async (message) => {
          attempts.push(message);
          return sendMessage(attempts.length, message);
        },
      },
    },
  });
  vm.runInContext(
    readFileSync(join(__dirname, "..", "ui", "shared", "async.js"), "utf8"),
    context
  );
  return { context, attempts, waits };
}

function unreachable() {
  return new Error("Could not establish connection. Receiving end does not exist.");
}

test("renvoie le message tant que l'arriere-plan n'est pas joignable", async () => {
  const { context, attempts } = loadMessaging((attempt) => {
    if (attempt < 3) throw unreachable();
    return "rapport";
  });
  context.message = { type: "REGENERATE_SUMMARY", range: "day" };

  const result = await vm.runInContext("sendToBackground(message)", context);

  assert.equal(result, "rapport");
  assert.equal(attempts.length, 3);
  assert.equal(attempts[2].type, "REGENERATE_SUMMARY");
});

test("n'insiste pas sur une erreur metier du background", async () => {
  const { context, attempts } = loadMessaging(() => {
    throw new Error("Aucun profil LLM actif n'est configure.");
  });
  context.message = { type: "REGENERATE_SUMMARY" };

  await assert.rejects(
    vm.runInContext("sendToBackground(message)", context),
    /Aucun profil LLM actif/
  );
  assert.equal(attempts.length, 1);
});

test("abandonne en nommant l'appel reste sans reponse", async () => {
  const { context, attempts } = loadMessaging(() => {
    throw unreachable();
  });
  context.message = { type: "LIST_CALENDARS" };

  // Fenetre nulle : on abandonne des le premier echec, sans attendre 20 s.
  await assert.rejects(
    vm.runInContext("sendToBackground(message, { wakeTimeoutMs: 0 })", context),
    /LIST_CALENDARS.*1 tentative/s
  );
  assert.equal(attempts.length, 1);
});

test("laisse au demarrage a froid le temps de repondre", async () => {
  const { context, attempts, waits } = loadMessaging((attempt) => {
    // Un arriere-plan qui charge une Experiment API met plusieurs secondes.
    if (attempt < 6) throw unreachable();
    return "rapport";
  });
  context.message = { type: "REGENERATE_SUMMARY" };

  assert.equal(await vm.runInContext("sendToBackground(message)", context), "rapport");
  assert.equal(attempts.length, 6);
  // Attente croissante puis plafonnee, pour couvrir plusieurs secondes sans
  // marteler l'arriere-plan.
  assert.deepEqual(waits, [200, 400, 800, 1600, 2000]);
});

test("les pages qui parlent au background passent toutes par le renvoi", () => {
  for (const file of [
    ["ui", "sidebar", "sidebar.js"],
    ["ui", "sidebar", "chat.js"],
    ["ui", "options", "options.js"],
  ]) {
    const source = readFileSync(join(__dirname, "..", ...file), "utf8");
    assert.doesNotMatch(
      source,
      /messenger\.runtime\.sendMessage\(/,
      `${file.join("/")} contourne sendToBackground`
    );
  }

  for (const page of [["ui", "sidebar", "sidebar.html"], ["ui", "options", "options.html"]]) {
    assert.match(
      readFileSync(join(__dirname, "..", ...page), "utf8"),
      /<script src="\.\.\/shared\/async\.js"><\/script>/,
      `${page.join("/")} ne charge pas le helper partage`
    );
  }
});
