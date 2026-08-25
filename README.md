# Madame Michu — Conciergerie de messagerie (Thunderbird)

**Madame Michu** est une extension Thunderbird qui genere chaque jour une synthese detaillee des mails
avec un paragraphe general, puis quatre categories **Urgent**, **Important**,
**Info** et **Autre** affichees ensemble sur une vue unique. Elle detecte
automatiquement les propositions de rendez-vous dans les mails recus pour les
ajouter au calendrier (Lightning) avec controle anti-doublon, et propose un
chatbot capable soit de rechercher des informations dans la boite mail, soit
de papoter librement sans consulter l'index.
Dans le chat, elle adopte une voix de concierge cinglante, profondement blasee,
rancuniere et vindicative : chaque question l'interrompt et l'agace, meme si elle
repond toujours utilement. Seul un vrai ragot source lui rend momentanement son
enthousiasme, sans jamais sacrifier les sources et la precision.

Quatre types de providers sont disponibles : **Ollama**, toute API exposant les
endpoints compatibles OpenAI `chat/completions` et `embeddings`, et l'API
**Anthropic Messages**, ainsi que **ChatGPT Plus/Pro via Codex OAuth**. Plusieurs profils peuvent etre configures et ordonnes :
si le premier profil actif echoue, l'assistant essaie automatiquement le suivant.

La vue Rapports propose trois periodes independantes : **Jour** (depuis minuit la veille),
**Semaine** (depuis lundi) et **Mois** (depuis le premier du mois). La
premiere ouverture genere successivement les trois rapports manquants. Les ouvertures
suivantes verifient immediatement le rapport **Jour** en arriere-plan et ne regenerent
Semaine ou Mois que si leur rapport est absent. La derniere version connue reste affichee pendant l'attente. En
l'absence de nouveau mail, le rapport et sa date restent inchanges et aucun appel
LLM n'est effectue. La regeneration manuelle force en revanche la periode
selectionnee. L'actualisation periodique ne verifie que le resume du jour et de
la veille afin de limiter les appels LLM.
Chaque element classe conserve ses mails sources et affiche une icone permettant
de les ouvrir directement dans un onglet Thunderbird. Les sources affichees sous
les reponses du chat utilisent le meme mecanisme. Une ligne visuelle **Nom / Action /
Besoin** place les informations essentielles au-dessus du detail de chaque element.
Un encart meteo pour Montpellier est affiche par defaut dans la barre superieure de la page. Il est
alimente directement par Open-Meteo, sans appel au LLM et sans acces aux mails.
Le flash voisin lit toutes les cinq minutes un flux RSS ou Atom configurable. The Conversation
France est propose par defaut. Les themes sont choisis dans les options ; les titres ne sont ni
resumes ni reecrits par le LLM.

## Arborescence

```
manifest.json
background/
  background.js       point d'entree, listeners (alarme, action, messages)
  mailFetcher.js       recuperation + extraction du texte des mails par periode
  scheduler.js          planification de l'alarme quotidienne
llm/
  httpClient.js         erreur commune LlmCallError et gestion du timeout des connecteurs
  promptBuilder.js      construction du prompt (system + user) pour le resume
  ollamaClient.js        appel HTTP vers l'API Ollama (/api/chat), JSON ou texte libre
  openAiCompatibleClient.js  appels Chat Completions et Embeddings compatibles OpenAI
  anthropicClient.js    appels a l'API Anthropic Messages
  openAiCodexClient.js  OAuth PKCE et appels au backend Codex de ChatGPT
  providerClient.js      aiguillage et repli ordonne entre les profils
  responseParser.js     parsing robuste du JSON retourne par le LLM (resume + RDV)
  embeddingClient.js    appel HTTP vers l'API Ollama (/api/embed)
  vectorStore.js         stockage local des embeddings de mails (IndexedDB), cache en
                         memoire et recherches cosinus / lexicale
calendar/
  calendarService.js    creation d'evenements via le pont Lightning, anti-doublon
experiments/
  assistantCalendar/    pont privilegie minimal vers l'API interne Lightning
background/
  mailIndexer.js         indexation incrementale des mails pour le chatbot
  chatService.js          recherche hybride + reponse LLM restreinte a la boite mail
utils/
  logger.js              logs avec redaction des champs sensibles
  storage.js              acces centralise a messenger.storage.local
  htmlToText.js           conversion HTML -> texte + troncature
ui/
  shared/async.js         timeout d'interface et renvoi des messages vers l'arriere-plan
  sidebar/                vue en deux colonnes "Rapports" et "Chat" (ouverte via le bouton de la barre d'outils)
  options/                page de configuration
ARCHITECTURE.md          flux d'execution, responsabilites et invariants techniques
CONTRIBUTING.md          conventions de code, tests et procedure de modification
icons/
artwork/madame-michu/   portraits haute definition, expressions et poses variees
ui/sidebar/portraits/   portraits optimises affiches selon l'humeur du chat
```

## Prerequis

- Thunderbird 128 ou plus recent (Manifest V3).
- Soit [Ollama](https://ollama.com) installe et lance en local :
  ```bash
  ollama serve
  ollama pull llama3.1
  ```
- Un calendrier local (Lightning) configure dans Thunderbird pour recevoir les
  evenements.
- Pour le chatbot mailbox avec Ollama : un modele d'embedding, par exemple :
  ```bash
  ollama pull nomic-embed-text
  ```

## Installation en mode developpeur

1. Ouvrir Thunderbird.
2. Menu **Outils > Modules complementaires et themes** (ou `Ctrl+Shift+A`).
3. Cliquer sur l'icone d'engrenage en haut a droite, puis **Deboguer les
   modules complementaires** (ce qui ouvre `about:debugging`).
4. Cliquer sur **Charger un module complementaire temporaire...**.
5. Selectionner le fichier `manifest.json` a la racine de ce depot.
6. Accepter l'avertissement d'acces complet. Thunderbird l'impose a toute
   extension embarquant une Experiment API, ici necessaire pour Lightning.
7. L'extension apparait dans la barre d'outils du mail sous le nom **Madame
   Michu**. Cliquer dessus ouvre ses rapports.
8. Ouvrir les **Options** de l'extension (depuis le module ou le bouton
   "Options" de la sidebar) pour configurer le provider, son URL, le modele, l'heure
   du resume automatique, les dossiers a scanner et le seuil de confiance. Par
   defaut, le resume et l'index couvrent tous les dossiers de courrier ; les
   dossiers techniques (Brouillons, Envoyes, Corbeille, Indesirables, Modeles
   et Boite d'envoi) sont ignores.

> Une modification de `manifest.json` (notamment de la liste `background.scripts`)
> n'est pas toujours prise en compte par le bouton **Recharger** : retirer puis
> recharger le module evite un arriere-plan qui ne demarre pas.

> Le module temporaire est retire au redemarrage de Thunderbird : il faut
> recharger l'etape 4-5 a chaque session de developpement. Utiliser le bouton
> **Recharger** dans `about:debugging` apres chaque modification du code.

## Configurer les profils LLM

1. Chaque onglet de la section **Profils LLM et ordre de secours** correspond a
   un profil. **Ajouter** cree un profil ; les boutons de priorite changent
   l'ordre dans lequel ils seront essayes. Un profil peut etre desactive sans
   etre supprime. Les modifications des profils sont sauvegardees immediatement ;
   le bouton **Enregistrer** valide et sauvegarde l'ensemble des autres options.
   Le champ **Profil utilise en priorite** choisit explicitement le premier profil
   appele, independamment de l'onglet actuellement ouvert pour edition.
2. Choisir **Ollama**, **OpenAI / API compatible OpenAI**, **ChatGPT Plus/Pro
   (Codex OAuth)** ou **Anthropic**. ChatGPT Plus ne fournit pas de cle pour
   l'API OpenAI classique, mais le profil Codex permet de se connecter au compte
   ChatGPT et d'utiliser l'acces compris dans un abonnement eligible.
3. Saisir l'URL de base exacte. Par exemple,
   `https://chatbot.argo.inrae.fr/openai` appelle d'abord
   `/openai/chat/completions`, puis `/openai/v1/chat/completions` si la premiere
   route manque. Pour Anthropic, l'URL par defaut est
   `https://api.anthropic.com`.
4. Saisir la cle API si necessaire et le nom exact du modele. Le bouton
   **Charger les modeles disponibles** interroge le profil selectionne, puis affiche une liste deroulante permettant de choisir directement le modele. La saisie manuelle reste disponible.
5. **Tester la connexion** controle uniquement le profil affiche et distingue
   notamment serveur inaccessible, timeout et authentification refusee.
6. Pour la recherche semantique, saisir un modele d'embedding dans un profil
   Ollama ou compatible OpenAI. Le premier profil actif qui en possede un est
   utilise pour tout l'index ; Anthropic ne fournit pas d'API d'embeddings.
7. Enregistrer puis accepter les demandes d'acces aux domaines distants.

Pour le profil **ChatGPT Plus/Pro (Codex OAuth)**, cliquer sur **Se connecter
avec ChatGPT**, terminer l'authentification dans l'onglet OpenAI puis choisir un
modele. Thunderbird intercepte normalement le callback local. Si la derniere
page affiche une erreur localhost, copier son URL complete et la coller dans le
champ de retour manuel. Les appels au backend Codex utilisent le flux SSE impose
par ce service, puis reconstituent localement la reponse complete. Pour limiter
la latence, ils utilisent un effort de raisonnement `low`. Le connecteur n'envoie
pas `max_output_tokens` : ce parametre de l'API Responses publique est refuse par
le backend d'abonnement Codex. Les jetons sont renouveles automatiquement. Ce provider
ne fournit pas d'embeddings : un autre profil Ollama ou compatible OpenAI peut
rester charge de l'index semantique. Le flux de connexion est documente par
OpenAI, mais l'utilisation directe du backend Codex par une extension tierce
reste experimentale et devra suivre ses evolutions.

Une connexion OAuth provenant d'une ancienne version dont le profil n'avait pas
ete enregistre est recuperee automatiquement. Il suffit alors de reselectionner
le modele, information qui ne fait pas partie du jeton OAuth.

Pendant un resume ou une reponse du chat, les profils actifs sont essayes dans
leur ordre. Une erreur reseau, un timeout, un refus d'authentification, une
limite de requetes, un modele absent, une autre erreur HTTP ou un resume JSON
inexploitable declenche le profil suivant. Si tous echouent, leurs diagnostics
sont regroupes sans exposer les cles. Un profil de chat silencieux est abandonne
apres 30 secondes (75 secondes pour un resume). Si le provider d'embedding est
indisponible, le chat repasse en recherche lexicale avant d'executer cette chaine
de secours, afin de ne pas melanger des vecteurs issus de modeles incompatibles.

## Tester sans consommer d'appels LLM

Activer **Mode dry-run** dans les options : le resume genere indique combien
de mails auraient ete envoyes au LLM, sans effectuer d'appel reel ni proposer
de RDV. Utile pour valider la recuperation des mails et le declenchement de
l'alarme avant de brancher le provider.

## Fonctionnement

1. Une alarme (`messenger.alarms`) declenche chaque jour a l'heure configuree
   la generation notifiee du resume (`background/scheduler.js`). Une seconde
   alarme, configurable dans les options et reglee par defaut sur une heure,
   verifie silencieusement le resume pendant que Thunderbird fonctionne. Sans
   nouveau mail depuis le dernier rapport, elle conserve celui-ci sans appeler
   le LLM ni modifier sa date de generation.
2. `mailFetcher.js` resout les dossiers par identifiant, nom, chemin ou role
   special (`INBOX` correspond donc a la boite de reception meme localisee),
   interroge `messenger.messages.query()` et parcourt toutes ses pages. Il filtre
   depuis minuit la veille pour le resume Jour, rassemble les en-tetes de tous
   les dossiers, les trie par date decroissante, puis applique la limite de
   messages. Les corps des messages retenus sont lus en parallele, sans jamais
   depasser le nombre de mails demande. Ainsi, un ancien message du premier dossier ne peut plus evincer un
   mail recu le matin dans un autre dossier. Les corps retenus sont convertis en
   texte tronque (`utils/htmlToText.js`) pour limiter le volume envoye au LLM.
3. `llm/promptBuilder.js` construit un prompt demandant une reponse JSON
   stricte (`summary` + `events`). `providerClient.js` essaie les profils actifs
   dans leur ordre via Ollama, Chat Completions compatible OpenAI, Anthropic
   Messages ou le backend Responses de Codex.
4. `llm/responseParser.js` extrait et valide le JSON (tolerant aux blocs
   ```json ou texte parasite autour).
5. Le resultat est stocke (`messenger.storage.local`) et affiche dans la
   sidebar. Chaque element du resume conserve les `Message-ID` valides annonces
   par le LLM ; une icone enveloppe ouvre le mail source via
   `messenger.messageDisplay.open()`. Les RDV sont filtres selon le niveau de
   confiance minimum choisi dans les options.
6. Les rendez-vous concernant directement le proprietaire de la boite sont
   ajoutes automatiquement via `messenger.assistantCalendar.createEvent`, avec
   verification anti-doublon sur titre+date. Le calendrier actif et modifiable
   contenant **INRAE** dans son nom est choisi par defaut. Cette automatisation
   et le calendrier cible restent configurables dans les options ; en cas
   d'echec, les boutons manuels **Ajouter au calendrier** et **Ignorer** restent
   disponibles.

## Demander a Madame Michu (mails et papotage)

Le chat utilise un routage automatique : il distingue une conversation ordinaire,
une relance contextuelle, une recherche dans la messagerie, un bilan mails/calendrier
et une demande de ragots sources. L'utilisateur n'a pas a choisir un mode ni a employer
une phrase declencheuse. Les demandes generales comme « quoi de neuf ? » utilisent le
rapport local compatible lorsqu'il est a jour, puis les extraits indexes et dates. Les
questions telles que **"Quand est ma prochaine reunion ?"** consultent
directement les calendriers Thunderbird actifs, sans exiger que les mails
soient indexes. Madame Michu recupere aussi le prenom de l'identite du compte
Thunderbird (ou le deduit de l'adresse) afin de s'adresser naturellement a son
proprietaire, sans transmettre l'adresse complete au LLM :

1. Des le premier message, l'actualisation de l'index demarre en arriere-plan
   si son dernier passage date de plus de dix minutes. Elle ne bloque donc pas
   une reponse conversationnelle et son etat technique n'encombre pas le chat.
   Cela recupere les mails des dossiers configures (option "Dossiers a
   indexer"), non deja indexes, sur la fenetre "Anciennete max des mails
   indexes", puis les stocke localement dans IndexedDB. Si un modele d'embedding
   est configure, son vecteur est calcule via `/api/embed` pour Ollama ou
   `/v1/embeddings` pour un provider compatible OpenAI. L'indexation est
   incrementale : les passages suivants traitent les mails restants par lots
   (`indexBatchSize`). Le
   premier mail du lot valide le provider d'embedding, les suivants sont
   traites par petits groupes paralleles.
   Un dossier momentanement illisible est signale puis ignore sans annuler les
   autres. Si le provider d'embedding echoue, Madame Michu poursuit le lot en
   mode lexical afin que l'index reste utilisable.
2. Poser une question dans le champ de saisie. Pour une recherche dans les mails,
   le chat
   fusionne la similarite semantique avec une recherche lexicale afin de conserver
   aussi les noms, references et formulations exactes. Sans embeddings, la recherche
   lexicale reste disponible. Les deux dernieres questions utilisateur enrichissent
   la requete de recherche, ce qui permet les questions de suivi comme « et pour
   quelle date ? ». Les `chatTopK` extraits les plus proches sont injectes dans le prompt envoye au LLM avec une consigne stricte :
   repondre uniquement a partir de ces extraits, et dire explicitement qu'elle
   ne trouve pas l'information si elle n'y est pas. Chaque reponse affiche les
   mails source utilises. Pour le papotage, aucun extrait de mail n'est envoye.
   Pour une demande de ragots, les resultats pertinents sont completes par les mails recents.
   Madame Michu glisse naturellement les details sources dans une phrase, une
   comparaison ou une anecdote, puis conclut par un commentaire cynique. Elle cite
   chaque element et ne transforme jamais une impression en fait. Pour une conversation
   ordinaire, aucun extrait de mail n'est ajoute au prompt.
3. Avec Ollama local, aucune donnee ne quitte la machine. Avec un provider distant,
   les extraits selectionnes, prompts et questions lui sont transmis uniquement apres
   consentement explicite. L'extension ne peut pas verifier sa collecte ou sa conservation ;
   un LLM local ou un service interne de confiance est donc recommande.

La recherche lexicale compare des mots entiers, avec une tolerance aux flexions
par prefixe : « contrat » retrouve « contrats » sans que « art » retrouve
« article ».

Limites connues : l'index est charge une fois puis conserve en memoire pour le
calcul de similarite (adapte a une boite mail personnelle, pas a des dizaines
de milliers de mails). Une premiere indexation volumineuse peut demander
plusieurs lots ; le bouton manuel permet alors de les enchainer immediatement.

## Developpement et maintenance

Les responsabilites des modules, le flux des rapports et du chat, ainsi que les
invariants de securite sont decrits dans [`ARCHITECTURE.md`](ARCHITECTURE.md).
Les conventions de code, la strategie de tests et la verification manuelle minimale
sont rassemblees dans [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Packaging (pour distribution)

```bash
npm run check
npm test
npm run package
```

Le XPI versionne est genere dans `dist/` avec son SHA-256. La procedure de beta,
la liste de controle ATN et les informations a fournir au reviewer sont detaillees
dans [`RELEASE.md`](RELEASE.md). Le fichier `.xpi` genere peut etre charge pour le developpement. Une installation
permanente ou une distribution publique exige une signature autorisant
l'Experiment API ; un XPI non signe sera refuse par une installation standard.

## Notes sur l'API calendrier

Thunderbird ne fournit pas encore d'API MailExtension calendrier native. Le
dossier `experiments/assistantCalendar/` contient donc un pont privilegie
minimal vers Lightning : lister les calendriers, rechercher les evenements
d'une journee et creer un evenement. Cette surface volontairement reduite
limite l'exposition aux changements internes de Thunderbird, mais elle devra
etre revalidee lors de chaque mise a niveau majeure.

## Licence

Copyright (C) 2026 Florian Ricquier.

Madame Michu est distribuee sous la licence
[GNU Affero General Public License version 3](LICENSE), sans clause « version
ulterieure » (`AGPL-3.0-only`). Les versions modifiees et redistribuees doivent
respecter les obligations de cette licence ; son article 13 couvre egalement
l'utilisation d'une version modifiee au travers d'un reseau.

## Securite

- Ollama ne demande aucune cle API. Pour OpenAI, une API compatible ou Anthropic, la cle
  est stockee dans `messenger.storage.local` et n'est jamais journalisee. Ce
  stockage est local au profil Thunderbird, mais n'est pas un coffre chiffre.
- Les access et refresh tokens Codex sont separes des profils mais restent dans
  `messenger.storage.local`, qui n'est pas un coffre chiffre. Ils ne sont jamais
  journalises et sont supprimes lors de la deconnexion ou de la suppression du profil.
- Un provider distant exige une autorisation explicite pour son origine et la
  permission `sensitiveDataUpload` avant l'enregistrement. Il exige egalement un
  consentement explicite et HTTPS ; HTTP reste limite a localhost. La politique
  complete est disponible dans [`PRIVACY.md`](PRIVACY.md).
- Changer le profil d'embedding, son URL ou son modele reinitialise l'index
  semantique afin de ne pas melanger des vecteurs incompatibles.
- Le rendu du resume et des sources utilise uniquement des noeuds texte ; le
  contenu genere par le modele n'est jamais injecte comme HTML executable.
