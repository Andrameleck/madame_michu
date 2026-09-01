# Architecture — version 2

Ce document decrit la refonte presente dans `src/`. Elle coexiste avec la
version 1 (`background/`, `llm/`, `ui/`, `calendar/`) jusqu'a la bascule du
manifeste, decrite en fin de document.

## Ce qui change, et pourquoi

| Version 1 | Version 2 |
| --- | --- |
| Scripts globaux charges dans l'ordre du manifeste | Modules ES, dependances explicites par `import` |
| `providerClient.js` : quatre cascades de `if (type === ...)` | Registre de fournisseurs + adaptateurs a contrat unique |
| Cles API rangees dans les profils | Secrets isoles dans une cle de stockage distincte |
| Index vectoriel maison dans IndexedDB | `messages.query`, l'index natif de Thunderbird |
| Intentions de chat classees par expressions regulieres | Le modele appelle des outils et choisit ses mots-cles |
| Reglages a plat, valeurs par defaut dupliquees | Configuration sectionnee, schema unique, migration versionnee |

Le fil directeur : **une decision, un seul endroit**. Le format d'un fournisseur
n'est connu que de son adaptateur ; la liste des reglages n'existe qu'une fois ;
la question « faut-il fouiller les mails ? » n'est plus tranchee par du code mais
par le modele, qui dispose pour cela d'outils.

## Couches

```text
        ui/options            ui/sidebar
             \                   /
              \                 /            core/messaging.js
               \               /             (message court ou port persistant)
                v             v
            background/operations.js   ← la seule surface publique
                      |
        +-------------+--------------+---------------+
        |             |              |               |
   features/      features/      features/       core/settings.js
    reports         chat           events        (schema + migration)
        |             |              |
        |        agent/runner.js     |            ← boucle outils
        |             |              |
        +------> agent/tools <-------+
                      |
              mail/repository.js   calendar/repository.js
                      |
                llm/gateway.js                    ← point d'entree LLM unique
                      |
        +-------------+------------+--------------+
     ollama         openai      anthropic       chatgpt
```

Regle de dependance : une couche n'importe que vers le bas. `features/` ignore
le dialecte des fournisseurs, `llm/` ignore l'existence des mails,
`agent/` ignore quel fournisseur repond.

## Couche LLM

`llm/registry.js` decrit chaque fournisseur : mode d'authentification, URL par
defaut, capacites (outils natifs, JSON contraint, listing de modeles) et
**champs de configuration**. La page d'options engendre son formulaire a partir
de ces champs : ajouter un fournisseur ne demande aucune ligne dans l'interface.

`llm/gateway.js` est le seul point d'entree. Il :

1. resout le profil (configuration + secret) en un contexte d'appel ;
2. verifie le consentement d'envoi distant et la permission d'origine ;
3. delegue a l'adaptateur, qui traduit dans le dialecte du service ;
4. essaie le profil suivant si l'echec est reessayable.

L'ordre des profils **est** l'ordre de repli. Un profil local place en dernier
garantit un fonctionnement hors ligne.

### Outils : natifs ou emules

Tous les fournisseurs supportes savent appeler des outils, mais tous les
*modeles* ne le savent pas — c'est frequent chez les petits modeles Ollama.
Quand un service refuse une requete a outils, la gateway rebascule sur un
protocole textuel (`llm/toolEmulation.js`) : le modele repond par un objet JSON
`{"action":"tool", ...}` ou `{"action":"answer", ...}`. Le reste de
l'application ne voit aucune difference. La bascule est memorisee pour le couple
profil/modele, en memoire seulement : un modele mis a jour retrouve ses
capacites au redemarrage.

### Ajouter un fournisseur

1. `src/llm/adapters/<nom>.js` exportant `{ chat, listModels }` ;
2. une entree dans `PROVIDERS` (`src/llm/registry.js`) ;
3. un test qui fige la forme reseau, sur le modele de `tests/v2/llmGateway.test.mjs`.

Rien d'autre : ni le formulaire, ni la gateway, ni les fonctionnalites ne
changent.

## Recherche : outils plutot qu'index

Il n'y a plus de base vectorielle, plus d'indexation a maintenir, plus
d'embeddings. Thunderbird indexe deja les messages ; `messages.query` accepte
`fullText`, `author`, `subject`, `body`, `recipients`, des bornes de dates et des
filtres d'etat. `agent/tools/mailTools.js` expose ces criteres au modele, qui
formule lui-meme sa recherche, la relance autrement si elle ne donne rien, puis
lit les messages retenus.

Consequence directe : les sources affichees sont **celles que le modele a
reellement consultees**, deduites des outils appeles, et non un contexte injecte
d'avance en esperant qu'il serve.

**Le chat et les rapports n'ont pas le meme perimetre.** Les reglages de
dossiers et de volume bornent un rapport quotidien ; les appliquer a une question
la rendrait inutile — on ne retrouve pas un vieux message dans un perimetre
limite a la boite de reception. `resolveChatScope` ne retient donc que la
selection de comptes, seule restriction posee volontairement par l'utilisateur ;
`resolveScope` sert aux rapports. Deux fonctions distinctes plutot qu'un
parametre, pour que la confusion ne puisse pas revenir.

Les outils renvoient toujours au modele les filtres qu'il a lui-meme appliques,
et l'avertissent quand un tri par anciennete est combine a une restriction : un
extremum local presente comme absolu est l'erreur la plus facile a commettre.

## Ecritures et confiance

- Le contenu des mails est une donnee, jamais une instruction. Le prompt systeme
  le rappelle et aucun contenu ne peut le modifier.
- Rien n'est ecrit dans l'agenda sans validation, sauf automatisme active
  explicitement. Les propositions passent par `features/pendingWrites.js`, dont
  les mutations sont serialisees.
- Tout l'affichage passe par `textContent` (`ui/shared/dom.js`). Aucun
  `innerHTML`, jamais, sur une sortie de modele ou un contenu de mail.
- Les secrets vivent dans la cle `secrets`, jamais dans `config`. Le journal les
  redige (`core/logger.js`), y compris imbriques.

## Interface

L'apparence est celle de la version 1 : fond creme, vert sauge, titres en serif,
panneaux arrondis, portrait de Madame Michu et son humeur, station a deux
colonnes au-dela de 980 px. Le balisage et les scripts, eux, sont neufs.

Deux differences de fond avec la version 1 :

- **Traduction par cles.** La version 1 traduisait en cherchant chaque phrase
  francaise dans une table de correspondance : corriger une faute de frappe
  cassait l'anglais sans bruit. Chaque element porte desormais une cle
  `data-i18n`, et `tests/v2/ui.test.mjs` verifie qu'aucune cle du balisage ne
  manque au dictionnaire, dans les deux langues.
- **Humeur deduite du deroulement.** Le portrait ne repose plus sur des
  expressions regulieres appliquees au texte de la reponse, mais sur ce que la
  boucle d'outils sait : nombre de recherches, de sources, echec, limite
  atteinte (`features/chat/mood.js`).

Trois elements de la version 1 n'ont pas ete repris, faute de fonction derriere :
les widgets meteo et flash d'actualites, et la vue Actions (brouillon, tache,
modification d'evenement). Les deux portraits « ragot » sont ecartes pour la
meme raison. Les reglages devenus sans objet — modele d'embedding, dossiers
indexes, profondeur d'index, `chatTopK` — disparaissent avec l'index.

## Frontiere avec Thunderbird

| Module | Seul a utiliser |
| --- | --- |
| `mail/repository.js` | `messenger.messages`, `messenger.accounts` |
| `calendar/repository.js` | `messenger.assistantCalendar` (Experiment API) |
| `core/storage.js` | `messenger.storage.local` |
| `core/messaging.js` | `messenger.runtime` |
| `core/permissions.js` | `messenger.permissions` |
| `background/scheduler.js` | `messenger.alarms` |

`experiments/assistantCalendar/` reste la seule partie privilegiee et est
reprise telle quelle de la version 1. Toute montee de version majeure de
Thunderbird exige un test manuel de ce pont avant d'elargir
`strict_max_version`.

## Tests

`tests/v2/` couvre :

- `llmGateway` : repli entre profils, consentement, transport des cles,
  normalisation des appels d'outils des trois dialectes, bascule vers
  l'emulation et sa memorisation ;
- `agentRunner` : contrainte des arguments, erreurs d'outil rendues au modele,
  boucle et limite de tours ;
- `settings` : valeurs par defaut, refus des profils invalides, isolation des
  secrets, migration complete depuis la version 1 ;
- `normalisation` : ce que l'application corrige dans une sortie de modele ;
- `moduleGraph` : le graphe d'imports se resout, les contrats sont exposes ;
- `manifest` : chaque fichier reference existe, permissions minimales.

Aucun test n'ouvre de connexion reseau : `fetch` est remplace par une sequence
de reponses.

## Bascule

L'extension tourne encore sur la version 1. Pour basculer :

1. `mv manifest.next.json manifest.json`, et aligner `package.json` sur la
   version qu'il porte (`tools/check.js` exige l'egalite) ;
2. supprimer `background/`, `llm/`, `calendar/`, `ui/`, `utils/`,
   `tests/*.test.js` (les tests v1) ;
3. mettre a jour l'outillage : `sourceDirectories` dans `tools/check.js` et la
   liste des dossiers empaquetes dans `tools/package.sh` deviennent `src` et
   `experiments` ;
4. `npm test` ne doit plus executer que `tests/v2/` ;
5. installer le XPI et verifier a la main : creation d'un profil, test de
   connexion, rapport du jour, une question dans la discussion, une proposition
   de rendez-vous.

La migration des donnees est automatique et se declenche au premier acces a la
configuration : les profils v1, leurs cles et les jetons OAuth sont repris.
Aucune action n'est demandee a l'utilisateur.
