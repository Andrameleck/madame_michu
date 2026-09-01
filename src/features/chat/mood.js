// Humeur de Madame Michu. Le portrait affiche n'est pas decoratif : il resume
// d'un coup d'oeil comment la reponse s'est passee — a-t-elle trouve, a-t-elle
// doute, a-t-elle echoue.
//
// La version 1 deduisait l'humeur du texte de la reponse a coups d'expressions
// regulieres. On s'appuie ici sur ce que la boucle d'outils sait reellement :
// combien de recherches, combien de sources, un echec, une limite atteinte.

export const MOODS = Object.freeze([
  "default",
  "exasperee",
  "furieuse",
  "soupconneuse",
  "profil-meprisant",
  "inspection-penchee",
  "epuisee-affaissee",
]);

// Un doute exprime par le modele merite le portrait soupconneux : c'est le seul
// signal que la boucle d'outils ne porte pas.
const HEDGING = /\b(peut[- ]etre|probable|semble|incertain|ambigu|a confirmer|pas clair|je ne suis pas sur)\b/i;

/**
 * @param {{ error?: boolean, exhausted?: boolean, sourceCount?: number,
 *           toolCount?: number, answer?: string }} outcome
 * @returns {typeof MOODS[number]}
 */
export function selectMood({
  error = false,
  exhausted = false,
  sourceCount = 0,
  toolCount = 0,
  answer = "",
} = {}) {
  if (error) return "furieuse";
  if (exhausted) return "epuisee-affaissee";
  // Une question ordinaire n'a declenche aucune recherche : rien a inspecter,
  // juste de la lassitude polie.
  if (toolCount === 0) return "exasperee";
  if (sourceCount === 0) return "epuisee-affaissee";
  if (HEDGING.test(answer)) return "soupconneuse";
  if (toolCount >= 3 || sourceCount >= 5) return "inspection-penchee";
  return "profil-meprisant";
}
