# Diffuser Madame Michu

## Avant chaque version

1. Tester l'extension dans chaque branche Thunderbird declaree compatible. Le pont
   calendrier est une Experiment API : mettre a jour `strict_max_version` uniquement
   apres un test reel sur la nouvelle branche.
2. Mettre la meme version dans `manifest.json` et `package.json`.
3. Executer `npm run check`, `npm test`, `npm run package`, puis `npm run package:source`.
4. Installer le XPI produit depuis `dist/` dans un profil Thunderbird de test vierge.
   Verifier l'ecran de consentement, les permissions, un provider local, un provider
   distant, les trois rapports, le chat, l'indexation et le calendrier.
5. Creer un tag Git correspondant a la version et conserver le commit exact soumis.

## Beta privee

Soumettre le XPI comme module auto-distribue dans le portail developpeur Thunderbird,
puis partager uniquement le paquet valide par ATN. Fournir aux testeurs la politique de
confidentialite et leur demander de commencer avec un profil Thunderbird de test.

## Publication dans le catalogue ATN

Fournir :

- le XPI genere et le depot/tag source correspondant ;
- la licence AGPL-3.0 de `LICENSE` et la mention `AGPL-3.0-only` ;
- les commandes de construction et de test ci-dessus ;
- les instructions reproductibles de `SOURCE_BUILD.md` ;
- la politique de confidentialite complete de `PRIVACY.md` ;
- des captures des rapports, du chat, des options et du consentement ;
- une justification de chaque permission et de l'Experiment calendrier ;
- des instructions permettant au reviewer de tester Ollama et un provider distant ;
- la mention explicite que le connecteur ChatGPT OAuth est experimental.

L'identifiant `ricquierflorian.madame-michu@addons.thunderbird.net` est definitif des la
premiere publication. Le changer ensuite creerait une autre extension et ferait perdre les
reglages existants lors de la migration.
