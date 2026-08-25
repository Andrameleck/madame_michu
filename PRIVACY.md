# Politique de confidentialite de Madame Michu

Derniere mise a jour : 21 aout 2026.

Madame Michu lit les messages, dossiers, identites et calendriers Thunderbird afin de
produire les rapports, recherches et rendez-vous demandes. L'index, les reglages, les cles
API et les jetons OAuth sont conserves dans le profil Thunderbird local. Les secrets ne sont
pas journalises, mais ce stockage n'est pas un coffre-fort chiffre.

Lorsqu'un provider distant est active et que le consentement est accepte, l'extension peut
lui transmettre les questions, prompts, sujets, expediteurs, dates, extraits de mails et
textes necessaires aux embeddings. L'extension ne peut pas verifier si son operateur collecte,
journalise, conserve ou reutilise ces donnees. Un LLM local est preferable ; un service distant
ne devrait etre utilise que si ses garanties, notamment internes a l'organisation, sont connues.
HTTP est reserve a localhost et les providers distants doivent utiliser HTTPS.

Madame Michu n'exploite aucun serveur propre, ne vend aucune donnee et n'integre aucune
telemetrie. La conservation par un provider LLM depend du service choisi et de son contrat.
Les questions peuvent etre deposees sur
<https://github.com/Andrameleck/madame_michu>.
