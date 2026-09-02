// Traduction de l'interface, sans dependance reseau.
//
// La version 1 traduisait en cherchant chaque phrase francaise dans une table :
// la moindre correction de texte cassait silencieusement l'anglais. Ici, chaque
// element porte une cle `data-i18n` et le dictionnaire est la reference.

export const LANGUAGES = ["fr", "en"];

const STRINGS = {
  // --- Barre haute ----------------------------------------------------------
  "topbar.nextEvent": { fr: "Prochain rendez-vous", en: "Next appointment" },
  "topbar.nextEvent.loading": { fr: "Chargement…", en: "Loading…" },
  "topbar.nextEvent.none": { fr: "Rien de prevu", en: "Nothing scheduled" },
  "topbar.options": { fr: "Options", en: "Settings" },
  "topbar.french": { fr: "Francais", en: "French" },
  "topbar.english": { fr: "Anglais britannique", en: "British English" },

  // --- Colonne rapports -----------------------------------------------------
  "reports.eyebrow": { fr: "La paperasse utile", en: "The useful paperwork" },
  "reports.heading": { fr: "Rapports", en: "Reports" },
  "reports.range.day": { fr: "Jour", en: "Day" },
  "reports.range.week": { fr: "7 jours", en: "7 days" },
  "reports.range.month": { fr: "30 jours", en: "30 days" },
  "reports.regenerate": { fr: "Refaire ce rapport", en: "Redo this report" },
  "reports.title.day": { fr: "Rapport du jour et de la veille", en: "Report for today and yesterday" },
  "reports.title.week": { fr: "Rapport des 7 derniers jours", en: "Report for the last 7 days" },
  "reports.title.month": { fr: "Rapport des 30 derniers jours", en: "Report for the last 30 days" },
  "reports.empty": {
    fr: "Aucun rapport pour l'instant. Demande a Madame Michu de le preparer.",
    en: "No report yet. Ask Madame Michu to prepare one.",
  },
  "reports.working": {
    fr: "Madame Michu depouille le courrier…",
    en: "Madame Michu is going through the post…",
  },
  "reports.nothing": { fr: "Rien a signaler sur cette periode.", en: "Nothing to report for this period." },
  "reports.retry": { fr: "Reessayer", en: "Try again" },
  "reports.messages": { fr: "message(s)", en: "message(s)" },
  "reports.generatedAt": { fr: "genere le", en: "generated on" },
  "reports.unchanged": { fr: "inchange depuis", en: "unchanged since" },
  "reports.openMail": { fr: "Ouvrir le message", en: "Open message" },
  "reports.deadline": { fr: "avant le", en: "by" },

  "importance.urgent": { fr: "A traiter en priorite", en: "Needs attention first" },
  "importance.important": { fr: "Important", en: "Important" },
  "importance.info": { fr: "Pour information", en: "For information" },
  "importance.autre": { fr: "Le reste", en: "The rest" },

  // --- Rendez-vous ----------------------------------------------------------
  "events.heading": { fr: "Rendez-vous detectes", en: "Detected appointments" },
  "events.calendarLabel": { fr: "Calendrier cible", en: "Target calendar" },
  "events.calendarDefault": { fr: "Premier calendrier accessible", en: "First writable calendar" },
  "events.empty": {
    fr: "Aucun rendez-vous detecte dans les mails de cette periode.",
    en: "No appointment detected in this period's mail.",
  },
  "events.scan": { fr: "Chercher des rendez-vous", en: "Look for appointments" },
  "events.scanning": { fr: "Analyse en cours…", en: "Scanning…" },
  "events.add": { fr: "Inscrire", en: "Add" },
  "events.ignore": { fr: "Ignorer", en: "Dismiss" },
  "events.added": { fr: "Inscrit a l'agenda", en: "Added to the calendar" },
  "events.ignored": { fr: "Ignore", en: "Dismissed" },
  "events.duplicate": { fr: "Deja present a l'agenda", en: "Already in the calendar" },
  "events.unavailable": {
    fr: "Le pont calendrier n'est pas disponible dans cette installation.",
    en: "The calendar bridge is not available in this installation.",
  },
  "events.readOnly": { fr: "lecture seule", en: "read-only" },
  "events.disabled": { fr: "desactive", en: "disabled" },
  "events.confidence.haute": { fr: "confiance haute", en: "high confidence" },
  "events.confidence.moyenne": { fr: "confiance moyenne", en: "medium confidence" },
  "events.confidence.basse": { fr: "confiance basse", en: "low confidence" },

  // --- Colonne discussion ---------------------------------------------------
  "chat.eyebrow": { fr: "La loge est ouverte", en: "The lodge is open" },
  "chat.heading": { fr: "Demande a Madame Michu", en: "Ask Madame Michu" },
  "chat.placeholder": {
    fr: "Demande un mail, une date, un expediteur…",
    en: "Ask about a mail, a date, a sender…",
  },
  "chat.inputLabel": { fr: "Message pour Madame Michu", en: "Message for Madame Michu" },
  "chat.send": { fr: "Envoyer", en: "Send" },
  "chat.start": { fr: "Tu peux commencer par : « Quoi de neuf ? »", en: "You could start with: “What's new?”" },
  "chat.newThread": { fr: "Nouvelle conversation", en: "New conversation" },
  "chat.newThreadDone": { fr: "Nouvelle conversation ouverte.", en: "New conversation started." },
  "chat.thinking": { fr: "Madame Michu reflechit…", en: "Madame Michu is thinking…" },
  "chat.busy": {
    fr: "Madame Michu termine la reponse precedente.",
    en: "Madame Michu is finishing the previous answer.",
  },
  "chat.sources": { fr: "message(s) consulte(s)", en: "message(s) consulted" },
  "chat.searches": { fr: "recherche(s) effectuee(s)", en: "search(es) performed" },
  "chat.noFilter": { fr: "sans filtre", en: "no filter" },
  "chat.exhausted": {
    fr: "Reponse partielle : la limite de recherches a ete atteinte.",
    en: "Partial answer: the search limit was reached.",
  },
  "chat.noAnswer": { fr: "Je n'ai rien trouve.", en: "I found nothing." },

  "tool.search_mail": { fr: "fouille les mails", en: "is digging through the mail" },
  "tool.read_mail": { fr: "lit un message", en: "is reading a message" },
  "tool.list_recent_mail": { fr: "parcourt le courrier recent", en: "is scanning recent mail" },
  "tool.list_events": { fr: "consulte l'agenda", en: "is checking the calendar" },
  "tool.create_event": { fr: "prepare un rendez-vous", en: "is preparing an appointment" },

  // --- Humeurs --------------------------------------------------------------
  "mood.default": { fr: "blasee", en: "unimpressed" },
  "mood.exasperee": { fr: "exasperee", en: "exasperated" },
  "mood.furieuse": { fr: "furieuse", en: "furious" },
  "mood.soupconneuse": { fr: "soupconneuse", en: "suspicious" },
  "mood.profil-meprisant": { fr: "meprisante", en: "scornful" },
  "mood.inspection-penchee": { fr: "en pleine inspection", en: "inspecting" },
  "mood.epuisee-affaissee": { fr: "epuisee", en: "exhausted" },
  "mood.ragot": { fr: "ravie par un ragot", en: "delighted by gossip" },
  "mood.ragot-renverse": { fr: "surexcitee par les ragots", en: "gossip-fuelled" },

  // --- Etats generaux -------------------------------------------------------
  "state.noProfile": {
    fr: "Aucun modele n'est configure.",
    en: "No model is configured.",
  },
  "state.openOptions": { fr: "Ouvrir les reglages", en: "Open settings" },

  // --- Page d'options -------------------------------------------------------
  "options.eyebrow": { fr: "La loge technique", en: "The technical office" },
  "options.title": { fr: "Options de Madame Michu", en: "Madame Michu settings" },
  "options.intro": {
    fr: "Les reglages sont groupes par fonction. Madame Michu essaie les profils dans l'ordre affiche, "
      + "puis applique les sources et automatismes choisis.",
    en: "Settings are grouped by purpose. Madame Michu tries the profiles in the order shown, "
      + "then applies the selected sources and automations.",
  },
  "options.providers.title": { fr: "Fournisseurs LLM", en: "LLM providers" },
  "options.providers.subtitle": {
    fr: "Connexion, modeles et ordre de secours.",
    en: "Connection, models and fallback order.",
  },
  "options.providers.help": {
    fr: "Les profils sont essayes de haut en bas. Un profil local place en dernier garantit un "
      + "fonctionnement meme sans reseau.",
    en: "Profiles are tried from top to bottom. A local profile placed last keeps everything working "
      + "even without a network.",
  },
  "options.providers.add": { fr: "Ajouter un profil", en: "Add a profile" },
  "options.providers.empty": {
    fr: "Aucun profil. Ajoutes-en un pour que Madame Michu puisse travailler.",
    en: "No profile yet. Add one so Madame Michu can work.",
  },
  "options.provider.name": { fr: "Nom du profil", en: "Profile name" },
  "options.provider.type": { fr: "Type de fournisseur", en: "Provider type" },
  "options.provider.enabled": { fr: "Actif", en: "Active" },
  "options.provider.up": { fr: "Augmenter la priorite", en: "Increase priority" },
  "options.provider.down": { fr: "Diminuer la priorite", en: "Decrease priority" },
  "options.provider.delete": { fr: "Supprimer", en: "Delete" },
  "options.provider.model": { fr: "Modele", en: "Model" },
  "options.provider.loadModels": { fr: "Charger les modeles", en: "Load models" },
  "options.provider.loading": { fr: "Chargement…", en: "Loading…" },
  "options.provider.test": { fr: "Tester la connexion", en: "Test connection" },
  "options.provider.testing": { fr: "Test en cours…", en: "Testing…" },
  "options.provider.keySaved": {
    fr: "Une cle est enregistree. Saisis-en une nouvelle pour la remplacer.",
    en: "A key is stored. Enter a new one to replace it.",
  },
  "options.provider.keyPlaceholder": { fr: "Colle ta cle ici", en: "Paste your key here" },
  "options.provider.keyStored": { fr: "•••••••• enregistree", en: "•••••••• stored" },
  "options.provider.connect": { fr: "Connecter mon compte ChatGPT", en: "Connect my ChatGPT account" },
  "options.provider.reconnect": { fr: "Reconnecter", en: "Reconnect" },
  "options.provider.connected": { fr: "Compte connecte", en: "Account connected" },
  "options.provider.disconnected": { fr: "Non connecte", en: "Not connected" },

  "options.config.title": { fr: "Configuration de Madame Michu", en: "Madame Michu configuration" },
  "options.config.subtitle": { fr: "Rapports, sources et calendrier.", en: "Reports, sources and calendar." },
  "options.schedule.legend": { fr: "Planification", en: "Scheduling" },
  "options.schedule.time": { fr: "Heure du rapport quotidien", en: "Daily report time" },
  "options.schedule.refresh": { fr: "Rafraichissement du rapport du jour", en: "Refresh of the daily report" },
  "options.schedule.off": { fr: "Desactive", en: "Disabled" },
  "options.schedule.every30": { fr: "Toutes les 30 minutes", en: "Every 30 minutes" },
  "options.schedule.every60": { fr: "Toutes les heures", en: "Every hour" },
  "options.schedule.every120": { fr: "Toutes les 2 heures", en: "Every 2 hours" },
  "options.schedule.every240": { fr: "Toutes les 4 heures", en: "Every 4 hours" },
  "options.language": { fr: "Langue de Madame Michu", en: "Madame Michu's language" },

  "options.sources.legend": { fr: "Boites analysees", en: "Mailboxes analysed" },
  "options.sources.allAccounts": { fr: "Tous les comptes", en: "All accounts" },
  "options.sources.accounts": { fr: "Comptes a utiliser", en: "Accounts to use" },
  "options.folders.legend": { fr: "Dossiers analyses", en: "Folders analysed" },
  "options.folders.all": {
    fr: "Tous les dossiers, et pas seulement la boite de reception",
    en: "All folders, not only the inbox",
  },
  "options.limits.legend": { fr: "Volume analyse", en: "Analysed volume" },
  "options.limits.maxMessages": { fr: "Messages lus par rapport", en: "Messages read per report" },
  "options.limits.maxChars": { fr: "Caracteres lus par message", en: "Characters read per message" },

  "options.calendar.legend": { fr: "Agenda", en: "Calendar" },
  "options.calendar.target": { fr: "Calendrier cible", en: "Target calendar" },
  "options.calendar.confidence": { fr: "Confiance minimale d'une detection", en: "Minimum detection confidence" },
  "options.calendar.confidence.basse": { fr: "Basse — tout proposer", en: "Low — propose everything" },
  "options.calendar.confidence.moyenne": { fr: "Moyenne", en: "Medium" },
  "options.calendar.confidence.haute": {
    fr: "Haute — seulement les dates certaines",
    en: "High — only certain dates",
  },
  "options.calendar.confirm": {
    fr: "Me demander confirmation avant d'ecrire dans l'agenda",
    en: "Ask me before writing to the calendar",
  },
  "options.calendar.auto": {
    fr: "Inscrire automatiquement les rendez-vous detectes",
    en: "Automatically add detected appointments",
  },

  "options.privacy.title": { fr: "Confidentialite", en: "Privacy" },
  "options.privacy.subtitle": {
    fr: "Consentement et limites de transmission.",
    en: "Consent and transmission limits.",
  },
  "options.privacy.consent": {
    fr: "Autoriser l'envoi du contenu des mails a un service distant",
    en: "Allow sending mail content to a remote service",
  },
  "options.privacy.help": {
    fr: "Sans cette autorisation, seuls les modeles executes sur cette machine sont utilises. "
      + "Les cles et jetons sont conserves dans le profil Thunderbird, qui n'est pas un coffre chiffre.",
    en: "Without this permission, only models running on this machine are used. Keys and tokens are "
      + "stored in the Thunderbird profile, which is not an encrypted vault.",
  },
  "options.save": { fr: "Enregistrer", en: "Save" },
  "options.saved": { fr: "Reglages enregistres.", en: "Settings saved." },
};

let current = "fr";

export function setLanguage(language) {
  current = LANGUAGES.includes(language) ? language : "fr";
  return current;
}

export function getLanguage() {
  return current;
}

/** Traduit une cle. Une cle absente se signale telle quelle plutot que vide. */
export function t(key, language = current) {
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[language] || entry.fr;
}

/**
 * Applique les traductions au document.
 * `data-i18n` remplit le texte, `data-i18n-attr="titre:cle"` remplit un attribut.
 */
export function applyTranslations(root = document, language = current) {
  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n, language);
  }
  for (const node of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of node.dataset.i18nAttr.split(",")) {
      const [attribute, key] = pair.split(":").map((part) => part.trim());
      if (attribute && key) node.setAttribute(attribute, t(key, language));
    }
  }
  document.documentElement.lang = language;
}
