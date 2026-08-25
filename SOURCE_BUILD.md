# Instructions de construction pour les reviewers ATN

## Environnement teste

- GNU/Linux x86_64 ;
- Bash 5 ou version compatible ;
- Node.js 18.19.1 ;
- npm 9.2.0 ;
- Info-ZIP `zip` 3.0 ;
- `sha256sum` fourni par GNU coreutils.

Le projet n'utilise aucune dependance npm, aucun bundler, aucun compilateur, aucun
transpileur, aucun moteur de templates et aucun outil de minification. Il ne faut donc
pas executer `npm install`. Tous les fichiers JavaScript, HTML et CSS places dans le XPI
sont les fichiers source lisibles presents dans cette archive.

Les fichiers de `artwork/madame-michu/` sont les portraits haute definition. Les PNG de
`ui/sidebar/portraits/` et `icons/` sont les actifs graphiques aux dimensions utilisees
par l'extension. Ils sont copies tels quels dans le XPI : la construction ne contacte
aucun service externe et ne regenere aucune image.

## Construction complete

Depuis la racine de l'archive source :

```bash
chmod +x tools/package.sh tools/package-source.sh
npm run check
npm test
npm run package
```

Le dernier appel cree `dist/madame-michu-0.10.8.xpi` et affiche son SHA-256. Le script
assemble sans transformation les chemins suivants :

```text
manifest.json
LICENSE
PRIVACY.md
background/
calendar/
llm/
utils/
ui/
icons/
experiments/
```

## Verification manuelle

```bash
unzip -l dist/madame-michu-0.10.8.xpi
```

Charger ensuite `manifest.json` comme module temporaire depuis `about:debugging`, ou
installer le XPI dans un profil Thunderbird de test. L'Experiment API calendrier impose
l'avertissement d'acces complet de Thunderbird.
