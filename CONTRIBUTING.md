# Contribuer au code

## Principes

- Preserver la confidentialite avant la commodite : aucun extrait de mail ne part vers un service
  distant sans les controles centralises dans `providerClient.js`.
- Garder les fonctions d'orchestration courtes et deleguer la transformation des donnees a des
  fonctions pures testables.
- Commenter une decision, une contrainte Thunderbird ou un invariant ; ne pas paraphraser le code.
- Utiliser des noms metier complets. Eviter les abreviations hors protocoles connus (`LLM`, `SMTP`).
- Ne pas introduire de dependance ou d'etape de build sans necessite documentee : le paquet ATN doit
  rester reproductible et lisible.

## Organisation d'une modification

1. Identifier la couche proprietaire du comportement dans `ARCHITECTURE.md`.
2. Ajouter d'abord un test reproduisant le cas ou proteger un invariant existant.
3. Modifier le plus petit nombre de couches possible.
4. Executer les validations locales.
5. Verifier manuellement dans Thunderbird les APIs que les tests simulent.

## Style JavaScript

Le projet utilise du JavaScript moderne compatible avec la plage Thunderbird du manifeste :

- `const` par defaut, `let` uniquement pour une reaffectation ;
- retours anticipes pour les cas invalides ;
- fonctions pures pour normaliser, filtrer et formater ;
- `async`/`await` aux frontieres asynchrones ;
- erreurs metier explicites, sans secrets ni corps de mails ;
- pas de mutation implicite d'une option recue en parametre ;
- pas de `innerHTML`, `eval` ou code genere.

Les scripts de background partagent un espace global. Un nom de fonction ou de constante doit donc
etre suffisamment specifique pour ne pas entrer en collision avec un autre fichier.

## Commentaires et documentation

Un commentaire est utile lorsqu'il explique :

- pourquoi une operation est sequentielle plutot que parallele ;
- pourquoi une periode ou un seuil a cette valeur ;
- une particularite de Thunderbird ou d'un fournisseur ;
- une frontiere de securite ;
- un repli volontaire en cas de panne.

Les commentaires tels que « incremente i » ou « appelle la fonction » sont a supprimer. Une nouvelle
fonction publique entre scripts doit etre mentionnee dans `ARCHITECTURE.md` si elle change un flux.

## Validation

```bash
npm run check
npm test
npm run package
```

`npm run check` valide les JSON et la syntaxe JavaScript. Les tests ne contactent aucun fournisseur.
Le XPI doit contenir la meme version que `manifest.json` et `package.json`.

Avant une publication, suivre aussi `RELEASE.md` et construire l'archive source avec
`npm run package:source`.

## Verification manuelle minimale

- premier lancement et generation des trois rapports absents ;
- actualisation sans nouveau mail ;
- recherche exacte et relance contextuelle dans le chat ;
- conversation sans envoi d'extrait mail ;
- provider local puis provider distant avec consentement ;
- ouverture d'une source et creation/anti-doublon d'un rendez-vous ;
- rendu francais et anglais ;
- redemarrage de Thunderbird et rechargement du module temporaire.
