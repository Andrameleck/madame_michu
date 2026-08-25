/* Traduction locale de la page d'options, sans dependance reseau. */
const OPTIONS_ENGLISH_TEXT = new Map(Object.entries({
  "La loge technique": "The technical office",
  "Options de Madame Michu": "Madame Michu settings",
  "Les reglages sont regroupes par fonction. Madame Michu utilise d'abord les fournisseurs LLM, puis les sources et automatismes choisis, sous reserve des autorisations de confidentialite.": "Settings are grouped by purpose. Madame Michu first uses the configured LLM providers, then the selected sources and automations, subject to the privacy permissions.",
  "Fournisseurs LLM": "LLM providers",
  "Connexion, modeles et ordre de secours.": "Connection, models and fallback order.",
  "Profils LLM et ordre de secours": "LLM profiles and fallback order",
  "Ajouter": "Add",
  "Madame Michu utilise le profil prefere en premier. En cas d'erreur, elle essaie automatiquement les autres profils actifs, de gauche a droite.": "Madame Michu uses the preferred profile first. If it fails, she automatically tries the other active profiles from left to right.",
  "Profil utilise en priorite": "Preferred profile",
  "Priorite +": "Priority +",
  "Priorite -": "Priority -",
  "Supprimer": "Delete",
  "Profil actif": "Active profile",
  "Nom du profil": "Profile name",
  "Type de provider": "Provider type",
  "URL de base": "Base URL",
  "Modele de chat": "Chat model",
  "Charger les modeles disponibles": "Load available models",
  "Modeles annonces par le provider": "Models reported by the provider",
  "Choisir un modele...": "Choose a model...",
  "Cle API": "API key",
  "Compte ChatGPT": "ChatGPT account",
  "Se connecter avec ChatGPT": "Sign in with ChatGPT",
  "Deconnecter": "Sign out",
  "URL de retour manuelle": "Manual callback URL",
  "Valider l'URL de retour": "Submit callback URL",
  "Si la page finale indique que localhost est inaccessible, copie son URL complete depuis la barre d'adresse et colle-la ici.": "If the final page says localhost cannot be reached, copy its full URL from the address bar and paste it here.",
  "Modele d'embedding de ce profil (optionnel)": "Embedding model for this profile (optional)",
  "Ollama reste entierement local et ne demande aucune cle API.": "Ollama remains entirely local and requires no API key.",
  "Tester la connexion": "Test connection",
  "Configuration de Madame Michu": "Madame Michu configuration",
  "Rapports, sources, memoire et calendrier.": "Reports, sources, memory and calendar.",
  "Planification": "Scheduling",
  "Heure du resume automatique": "Automatic report time",
  "Actualisation silencieuse du resume": "Silent report refresh",
  "Desactivee": "Disabled",
  "Toutes les 30 minutes": "Every 30 minutes",
  "Toutes les heures": "Every hour",
  "Toutes les 2 heures": "Every 2 hours",
  "Toutes les 4 heures": "Every 4 hours",
  "Madame Michu relit les mails du jour et de la veille a chaque actualisation. Elle appelle le LLM uniquement si de nouveaux messages sont arrives, sans afficher de notification.": "At each refresh, Madame Michu checks today's and yesterday's messages. She calls the LLM only when new messages have arrived, without displaying a notification.",
  "Boites de messagerie source": "Source mailboxes",
  "Toutes les boites integrees a Thunderbird (recommande)": "All mailboxes connected to Thunderbird (recommended)",
  "Boites a utiliser comme source": "Mailboxes to use as sources",
  "Ce reglage restreint le resume, la detection de rendez-vous et la memoire de recherche aux boites cochees lorsque plusieurs comptes existent dans Thunderbird. Les reglages de dossiers ci-dessous ne s'appliquent qu'a ces boites.": "When several accounts exist in Thunderbird, this setting limits reports, appointment detection and search memory to the selected mailboxes. The folder settings below only apply to those mailboxes.",
  "Dossiers a scanner": "Folders to scan",
  "Tous les dossiers de courrier (recommande)": "All mail folders (recommended)",
  "Noms ou chemins de dossiers, separes par des virgules": "Folder names or paths, separated by commas",
  "Madame Michu ignore automatiquement Brouillons, Envoyes, Corbeille, Indesirables, Modeles et Boite d'envoi.": "Madame Michu automatically ignores Drafts, Sent, Trash, Junk, Templates and Outbox folders.",
  "Memoire de Madame Michu (recherche mail)": "Madame Michu's memory (mail search)",
  "Indexer tous les dossiers de courrier (recommande)": "Index all mail folders (recommended)",
  "Dossiers a indexer, separes par des virgules": "Folders to index, separated by commas",
  "Anciennete max des mails indexes (jours)": "Maximum age of indexed messages (days)",
  "Nombre max de mails indexes par execution": "Maximum messages indexed per run",
  "Nombre d'extraits utilises pour repondre a une question": "Number of excerpts used to answer a question",
  "Madame Michu utilise le premier profil actif disposant d'un modele d'embedding. Avec un provider distant, le texte a vectoriser lui est transmis apres consentement. Sans modele compatible, elle conserve une recherche lexicale locale.": "Madame Michu uses the first active profile with an embedding model. With a remote provider, text to be vectorised is sent after consent. Without a compatible model, she keeps using local lexical search.",
  "Detection de rendez-vous": "Appointment detection",
  "Niveau de confiance minimum pour proposer un RDV": "Minimum confidence required to suggest an appointment",
  "Basse (tout proposer)": "Low (suggest everything)",
  "Moyenne": "Medium",
  "Haute (uniquement les plus surs)": "High (only the most certain)",
  "Madame Michu ajoute automatiquement les rendez-vous detectes": "Madame Michu automatically adds detected appointments",
  "Calendrier cible par defaut": "Default target calendar",
  "Madame Michu selectionne automatiquement le calendrier INRAE lorsqu'il est disponible et ignore les doublons de titre et de date.": "Madame Michu automatically selects the INRAE calendar when available and ignores duplicate titles and dates.",
  "Volume et diagnostic": "Volume and diagnostics",
  "Nombre max de mails traites par execution": "Maximum messages processed per run",
  "Longueur max du corps d'un mail (caracteres)": "Maximum message body length (characters)",
  "Madame Michu simule le rapport sans appeler le LLM (mode diagnostic)": "Madame Michu simulates the report without calling the LLM (diagnostic mode)",
  "Flash d'actualite": "News flash",
  "Adresse du flux RSS ou Atom": "RSS or Atom feed address",
  "The Conversation France est propose par defaut. Madame Michu ne reecrit pas les titres et actualise le flux toutes les cinq minutes.": "The Conversation France is provided by default. Madame Michu does not rewrite headlines and refreshes the feed every five minutes.",
  "Sciences et sante": "Science and health",
  "Technologies et IA": "Technology and AI",
  "Climat et environnement": "Climate and environment",
  "Societe et culture": "Society and culture",
  "Economie et travail": "Economy and work",
  "Confidentialite": "Privacy",
  "Consentement et limites de transmission au fournisseur LLM.": "Consent and data-sharing limits for the LLM provider.",
  "Transmission au LLM": "Data sent to the LLM",
  "Envoi vers les services LLM": "Sending data to LLM services",
  "Madame Michu peut transmettre a un provider distant les questions, prompts, objets, expediteurs, dates et extraits de mails necessaires aux rapports, embeddings et reponses. Avec Ollama configure sur cet ordinateur, aucune de ces donnees ne quitte la machine.": "Madame Michu may send a remote provider the questions, prompts, subjects, senders, dates and message excerpts required for reports, embeddings and answers. With Ollama configured on this computer, none of this data leaves the machine.",
  "J'accepte l'envoi de ces donnees aux providers distants que je configure.": "I consent to sending this data to the remote providers I configure.",
  "Avertissement : Madame Michu ne peut pas verifier les pratiques de collecte, journalisation ou reutilisation du LLM choisi. Des donnees peuvent etre conservees ou exploitees par son operateur a l'insu de l'utilisateur. Un LLM local, ou un service interne dont les garanties sont connues, reste preferable. Le consentement peut etre retire ici a tout moment.": "Warning: Madame Michu cannot verify the chosen LLM's collection, logging or reuse practices. Its operator may retain or use data without the user's knowledge. A local LLM, or an internal service with known safeguards, remains preferable. Consent can be withdrawn here at any time.",
  "Lire la politique de confidentialite": "Read the privacy policy",
  "Enregistrer": "Save",
  "Enregistre.": "Saved."
}));

let optionsUiLanguage = "fr";

function optionsText(french, english) {
  return optionsUiLanguage === "en" ? english : french;
}

function applyOptionsLanguage(language) {
  optionsUiLanguage = language === "en" ? "en" : "fr";
  document.documentElement.lang = optionsUiLanguage;
  document.title = optionsUiLanguage === "en" ? "Madame Michu - Settings" : "Madame Michu - Options";
  if (optionsUiLanguage !== "en") return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const source = node.nodeValue.replace(/\s+/g, " ").trim();
    const translated = OPTIONS_ENGLISH_TEXT.get(source);
    if (translated) node.nodeValue = `${node.nodeValue.match(/^\s*/)[0]}${translated}${node.nodeValue.match(/\s*$/)[0]}`;
  }
  document.querySelectorAll("[aria-label]").forEach((element) => {
    const translated = OPTIONS_ENGLISH_TEXT.get(element.getAttribute("aria-label"));
    if (translated) element.setAttribute("aria-label", translated);
  });
}
