# Politique de confidentialite de Madame Michu

Derniere mise a jour : 21 aout 2026.

Madame Michu lit les messages, dossiers, identites et calendriers Thunderbird afin de
produire les rapports, recherches et rendez-vous demandes. L'index, les reglages, les cles
API et les jetons OAuth sont conserves dans le profil Thunderbird local. Les secrets ne sont
pas journalises, mais ce stockage n'est pas un coffre-fort chiffre.

Lorsqu'un provider distant est active, l'extension peut lui transmettre les questions,
prompts, sujets, expediteurs, dates et extraits de mails necessaires a la fonction demandee.
Ces donnees sont envoyees uniquement au domaine configure par l'utilisateur, ou a OpenAI
pour le connecteur ChatGPT experimental. Ollama sur localhost reste entierement local.

Aucun contenu de mail n'est transmis a distance avant un consentement explicite dans les
options. Ce consentement peut etre retire a tout moment ; les appels distants sont alors
bloques. Les providers distants doivent utiliser HTTPS. HTTP est reserve a localhost.

Si le bulletin exterieur est active, la ville configuree est envoyee a Open-Meteo et
quelques mots-cles issus des objets de messages sont envoyes a GDELT pour rechercher des
actualites recentes. Les corps des messages, adresses et identifiants ne sont jamais
transmis a ces deux services. Cette fonction est desactivee par defaut.

Madame Michu n'exploite aucun serveur propre, ne vend aucune donnee et n'integre aucune
telemetrie. La conservation par un provider LLM depend du service choisi et de son contrat.
Les questions peuvent etre deposees sur
<https://github.com/Andrameleck/madame_michu>.
