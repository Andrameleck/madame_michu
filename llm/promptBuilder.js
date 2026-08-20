// Construction du prompt envoye au LLM local. Le format de sortie demande est du
// JSON strict pour pouvoir etre parse de facon fiable cote extension.

const SYSTEM_PROMPT = `Tu es un assistant qui analyse une liste de mails recus aujourd'hui dans une boite mail professionnelle.

Tu dois repondre UNIQUEMENT avec un objet JSON valide, sans texte avant ni apres, au format exact suivant :

{
  "summary": "<resume newsletter en Markdown, mails groupes par theme/importance>",
  "events": [
    {
      "title": "string",
      "date": "YYYY-MM-DD",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "location": "string ou vide",
      "description": "string",
      "sourceEmailId": "string",
      "confidence": "haute" | "moyenne" | "basse"
    }
  ]
}

Regles :
- N'invente jamais de rendez-vous : n'ajoute une entree dans "events" que si le mail propose ou confirme explicitement une date/heure de rendez-vous, reunion ou appel.
- "confidence" doit refleter la clarte de la proposition (haute = date/heure explicites et confirmees, basse = suggestion vague).
- Le resume doit rester concis, groupe par importance (urgent / a traiter / information), en Markdown.
- Si aucun rendez-vous n'est detecte, retourne "events": [].`;

function buildUserPrompt(emails) {
  const lines = emails.map((mail, idx) => {
    return [
      `--- MAIL ${idx + 1} ---`,
      `id: ${mail.id}`,
      `de: ${mail.author}`,
      `objet: ${mail.subject}`,
      `date: ${mail.date}`,
      `corps:`,
      mail.bodyText,
    ].join("\n");
  });

  return [
    `Voici ${emails.length} mail(s) recus aujourd'hui. Analyse-les et reponds au format JSON demande.`,
    "",
    ...lines,
  ].join("\n\n");
}

function buildPrompt(emails) {
  return {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(emails),
  };
}
