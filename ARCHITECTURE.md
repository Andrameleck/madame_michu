# Architecture technique

Ce document decrit les frontieres du code et les invariants a preserver. Madame Michu est une
MailExtension Thunderbird Manifest V3 sans bundler ni dependance npm. Les scripts declares dans
`manifest.json` partagent le contexte global du background et sont charges dans l'ordre indique.

## Vue d'ensemble

```text
Sidebar / Options
       |
       | runtime messages ou port persistant
       v
background/background.js
  |          |             |
  v          v             v
rapports     chat          calendrier
  |          |             |
mailFetcher  mailIndexer   calendarService
  |          |             |
  +------ providerClient --+
             |
       profils LLM ordonnes
```

La sidebar ne lit jamais directement les mails. Elle demande une operation au background, puis
rend un resultat deja nettoye. Les appels longs de generation utilisent un port persistant afin
que Thunderbird ne ferme pas le canal pendant l'attente du fournisseur LLM.

## Chargement du background

L'ordre de `background.scripts` tient lieu de graphe de dependances :

1. utilitaires et stockage ;
2. clients HTTP et fournisseurs LLM ;
3. stockage vectoriel et calendrier ;
4. acquisition/indexation des mails et service de chat ;
5. ordonnanceur et point d'entree.

Il n'y a volontairement ni imports ES modules ni etape de compilation. Ajouter un fichier global
exige donc de l'ajouter au manifeste avant ses consommateurs et au test de demarrage complet.

## Rapports

`background/background.js` orchestre une generation :

1. `mailFetcher.js` resout les comptes et dossiers, filtre la periode puis lit les corps ;
2. `calendarService.js` fournit les evenements deja presents ;
3. `promptBuilder.js` produit le contrat JSON demande au modele ;
4. `providerClient.js` essaie les profils actifs dans l'ordre ;
5. `responseParser.js` valide et normalise la reponse ;
6. le rapport est conserve par periode dans `messenger.storage.local`.

Les rapports Jour, 7 derniers jours et 30 derniers jours sont independants. Au premier affichage, la sidebar genere
sequentiellement les rapports absents. Ensuite, seule la periode Jour est verifiee automatiquement.
Un rapport existant est conserve si les identifiants des mails, le calendrier, la langue et la
version du filtre n'ont pas change.

## Chat et recherche locale

`background/chatService.js` est un pipeline, pas un simple prompt :

1. classification semantique avec garde-fous deterministes ;
2. choix entre conversation, relance, recherche mail, bilan ou ragot ;
3. construction d'une requete de recherche qui n'ajoute l'historique que pour une vraie relance ;
4. recherche lexicale et, si disponible, vectorielle ;
5. ajout eventuel d'un rapport local compatible pour les vues d'ensemble ;
6. generation de la reponse et resolution des marqueurs `[Mail N]` / `[Calendrier N]` ;
7. retour au front de la reponse, de l'humeur et des seules sources effectivement citees.

Les mails sont des donnees non fiables. Ils ne peuvent pas modifier le prompt systeme. Une reponse
factuelle issue de la messagerie doit porter un marqueur interne ; celui-ci est retire avant rendu.
Les questions ordinaires sont envoyees au LLM sans extrait de mail.

L'index est stocke dans IndexedDB par `llm/vectorStore.js`. Le cache prepare en memoire contient les
vecteurs normalises et les ensembles de termes necessaires aux recherches. Une panne d'embedding ne
bloque pas l'indexation ni le chat : la recherche lexicale reste utilisable.

## Fournisseurs et confidentialite

`llm/providerClient.js` expose le contrat commun et centralise le repli entre profils. Les clients
specifiques ne doivent pas connaitre l'interface. Avant tout envoi de donnees mail, le client commun
verifie l'autorisation d'origine, HTTPS pour les services distants, la permission Thunderbird et le
consentement explicite.

Les secrets sont stockes dans le profil Thunderbird, qui n'est pas un coffre chiffre. Ils passent
toujours par le logger redacteur. Aucun contenu de mail ne doit etre ajoute a un log, a une URL ou a
un message d'erreur affiche sans nettoyage.

## Interface

`ui/sidebar/sidebar.js` gere les rapports, les rendez-vous et l'initialisation. `ui/sidebar/chat.js`
gere uniquement le fil de discussion et ses sources. `ui/options/options.js` maintient un brouillon
de profils LLM, gere les permissions et persiste la configuration.

`background/weatherService.js` alimente un widget de page autonome. Il ne recoit aucun objet mail
et ne participe ni aux rapports ni au chat. Il transmet uniquement la ville configuree a Open-Meteo
et conserve la reponse trente minutes dans le stockage local.

Le rendu du contenu genere utilise des noeuds DOM et `textContent`. Ne pas remplacer ce mecanisme par
`innerHTML` : les sorties du LLM et les contenus de mails ne sont pas fiables.

## Pont calendrier

`experiments/assistantCalendar/` est la seule partie privilegiee. Elle encapsule l'API interne
Lightning derriere une surface minimale. Toute evolution de la version majeure de Thunderbird doit
etre accompagnee d'un test manuel de cette Experiment API avant d'elargir `strict_max_version`.

## Tests de non-regression

- `backgroundBoot.test.js` charge les vrais scripts du manifeste dans leur ordre ;
- les tests `*Client.test.js` figent les contrats reseau sans appel externe ;
- `chatService.test.js` couvre le routage, les dates, les sources et les protections conversationnelles ;
- `distribution.test.js` controle le contenu publiable et les metadonnees ;
- `sidebarLayout.test.js` protege les invariants structurels de l'interface.

Les tests utilisent des contextes `vm` car le code cible l'environnement global MailExtension.
