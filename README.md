# Assistant Mail IA (Thunderbird)

Extension Thunderbird qui genere chaque jour un resume newsletter des mails
recus, detecte automatiquement les propositions de rendez-vous pour les
ajouter au calendrier (Lightning) apres validation manuelle, et propose un
chatbot qui repond a des questions en se limitant strictement au contenu de
la boite mail (recherche semantique locale, aucune connaissance generale).

Le LLM utilise est **Ollama en local** (aucune donnee n'est envoyee a un
service externe). Modele par defaut : `llama3.1`, configurable dans les
options.

## Arborescence

```
manifest.json
background/
  background.js       point d'entree, listeners (alarme, action, messages)
  mailFetcher.js       recuperation + extraction du texte des mails du jour
  scheduler.js          planification de l'alarme quotidienne
llm/
  promptBuilder.js      construction du prompt (system + user) pour le resume
  ollamaClient.js        appel HTTP vers l'API Ollama (/api/chat), JSON ou texte libre
  responseParser.js     parsing robuste du JSON retourne par le LLM (resume + RDV)
  embeddingClient.js    appel HTTP vers l'API Ollama (/api/embeddings)
  vectorStore.js         stockage local des embeddings de mails (IndexedDB) + recherche cosinus
calendar/
  calendarService.js    creation d'evenements via messenger.calendar, anti-doublon
background/
  mailIndexer.js         indexation incrementale des mails pour le chatbot
  chatService.js          recherche semantique + reponse LLM restreinte a la boite mail
utils/
  logger.js              logs avec redaction des champs sensibles
  storage.js              acces centralise a messenger.storage.local
  htmlToText.js           conversion HTML -> texte + troncature
ui/
  sidebar/                onglets "Resume" (+ RDV a valider) et "Chat" (ouvert via le bouton de la barre d'outils)
  options/                page de configuration
icons/
```

## Prerequis

- Thunderbird 115 ou plus recent.
- [Ollama](https://ollama.com) installe et lance en local :
  ```bash
  ollama serve
  ollama pull llama3.1
  ```
- Un calendrier local (Lightning) configure dans Thunderbird pour recevoir les
  evenements.
- Pour le chatbot mailbox : un modele d'embedding Ollama, par exemple :
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
6. L'extension apparait dans la barre d'outils du mail (icone Assistant Mail
   IA). Cliquer dessus ouvre l'onglet resume.
7. Ouvrir les **Options** de l'extension (depuis le module ou le bouton
   "Options" de la sidebar) pour configurer l'URL Ollama, le modele, l'heure
   du resume automatique, les dossiers a scanner et le seuil de confiance.

> Le module temporaire est retire au redemarrage de Thunderbird : il faut
> recharger l'etape 4-5 a chaque session de developpement. Utiliser le bouton
> **Recharger** dans `about:debugging` apres chaque modification du code.

## Tester sans consommer d'appels LLM

Activer **Mode dry-run** dans les options : le resume genere indique combien
de mails auraient ete envoyes au LLM, sans effectuer d'appel reel ni proposer
de RDV. Utile pour valider la recuperation des mails et le declenchement de
l'alarme avant de brancher Ollama.

## Fonctionnement

1. Une alarme (`messenger.alarms`) declenche chaque jour a l'heure configuree
   la generation du resume (`background/scheduler.js`).
2. `mailFetcher.js` interroge `messenger.messages.query()` sur les dossiers
   configures, filtre sur la date du jour, et convertit chaque mail en texte
   tronque (`utils/htmlToText.js`) pour limiter le volume envoye au LLM.
3. `llm/promptBuilder.js` construit un prompt demandant une reponse JSON
   stricte (`summary` + `events`), envoye a Ollama via
   `llm/ollamaClient.js` (`POST /api/chat`, `format: "json"`).
4. `llm/responseParser.js` extrait et valide le JSON (tolerant aux blocs
   ```json ou texte parasite autour).
5. Le resultat est stocke (`messenger.storage.local`) et affiche dans la
   sidebar. Les RDV sont filtres selon le niveau de confiance minimum choisi
   dans les options.
6. Pour chaque RDV propose, l'utilisateur clique **Ajouter au calendrier**
   (creation via `messenger.calendar.items.create`, avec verification anti-
   doublon sur titre+date) ou **Ignorer**. Aucune creation automatique.

## Chatbot mailbox (onglet "Chat")

Le chatbot repond a des questions en se limitant strictement au contenu de la
boite mail :

1. Dans l'onglet **Chat** de la sidebar, cliquer sur **Mettre a jour l'index**.
   Cela recupere les mails des dossiers configures (option "Dossiers a
   indexer"), non deja indexes, sur la fenetre "Anciennete max des mails
   indexes", et calcule un embedding pour chacun via Ollama
   (`/api/embeddings`), stocke localement dans IndexedDB
   (`llm/vectorStore.js`). L'indexation est incrementale : relancer le bouton
   plusieurs fois traite les mails restants par lots (`indexBatchSize`).
2. Poser une question dans le champ de saisie. La question est elle-meme
   vectorisee, comparee par similarite cosinus aux mails indexes
   (`background/chatService.js`), et les `chatTopK` extraits les plus proches
   sont injectes dans le prompt envoye au LLM avec une consigne stricte :
   repondre uniquement a partir de ces extraits, et dire explicitement
   "Je ne trouve pas cette information dans tes mails." si l'information n'y
   est pas. Chaque reponse affiche les mails source utilises.
3. Aucune donnee ne quitte la machine : embeddings et reponses passent
   uniquement par l'instance Ollama locale configuree dans les options.

Limites connues : la recherche charge tous les vecteurs en memoire pour le
calcul de similarite (adapte a une boite mail personnelle, pas a des dizaines
de milliers de mails) ; l'index n'est pas mis a jour automatiquement, il faut
relancer "Mettre a jour l'index" periodiquement pour couvrir les nouveaux
mails.

## Packaging (pour distribution)

```bash
cd thunderbird_assitant
zip -r -FS ../assistant-mail-ia.xpi * -x "*.git*"
```

Le fichier `.xpi` genere peut ensuite etre installe via **Modules
complementaires > Installer un module a partir d'un fichier**, ou signe et
publie sur addons.thunderbird.net si une distribution publique est souhaitee.

## Notes sur l'API calendrier

L'API `messenger.calendar` de Thunderbird a evolue au fil des versions. Si
`messenger.calendar.items.create` ou `messenger.calendar.calendars.query`
n'est pas disponible sur ta version de Thunderbird, verifie la documentation
MailExtensions correspondante et adapte `calendar/calendarService.js` en
consequence (la logique metier — anti-doublon, mapping des champs — reste
valable independamment de la forme exacte de l'API).

## Securite

- La cle API (`apiKey` dans le storage) est reservee a un futur provider
  distant (Claude/OpenAI) ; elle n'est utilisee par aucun appel avec Ollama.
- Aucune cle n'est jamais loguee : `utils/logger.js` masque systematiquement
  les champs sensibles avant tout `console.*`.
- Aucun mail n'est envoye a un service externe : tous les appels LLM restent
  sur `localhost` (ou l'hote Ollama configure).
