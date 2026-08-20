// Chatbot restreint au contenu de la boite mail : recherche semantique sur les
// mails indexes (llm/vectorStore.js), puis reponse du LLM contrainte a
// n'utiliser que les extraits fournis.

const CHAT_SYSTEM_PROMPT = `Tu es un assistant qui repond a des questions EXCLUSIVEMENT a partir
d'extraits de mails fournis ci-dessous. Tu n'as le droit d'utiliser aucune
connaissance generale ni aucune information qui ne provient pas de ces extraits.

Regles strictes :
- Si la reponse ne se trouve pas dans les extraits fournis, reponds exactement :
  "Je ne trouve pas cette information dans tes mails." (n'invente rien).
- Quand tu utilises un extrait, reference-le sous la forme [Mail N] ou N est son numero.
- Reste concis et factuel.`;

function buildChatContext(matches) {
  return matches
    .map(({ record }, idx) => {
      return [
        `[Mail ${idx + 1}]`,
        `De: ${record.author}`,
        `Objet: ${record.subject}`,
        `Date: ${record.date}`,
        `Dossier: ${record.folder}`,
        `Extrait: ${record.excerpt}`,
      ].join("\n");
    })
    .join("\n\n");
}

async function answerMailboxQuestion(question, { history = [] } = {}) {
  const settings = await getSettings();

  const totalInIndex = await countVectors();
  if (totalInIndex === 0) {
    return {
      answer:
        "Aucun mail n'est encore indexe. Clique sur \"Mettre a jour l'index\" dans l'onglet Chat avant de poser une question.",
      sources: [],
    };
  }

  const queryEmbedding = await callOllamaEmbedding({
    baseUrl: settings.ollamaBaseUrl,
    model: settings.embeddingModel,
    text: question,
  });

  const matches = await searchSimilar(queryEmbedding, settings.chatTopK);
  const relevant = matches.filter((m) => m.score > 0);

  if (!relevant.length) {
    return {
      answer: "Je ne trouve pas cette information dans tes mails.",
      sources: [],
    };
  }

  const context = buildChatContext(relevant);
  const userPrompt = `Extraits de mails disponibles :\n\n${context}\n\nQuestion : ${question}`;

  const messages = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userPrompt },
  ];

  const answer = await callOllamaChat({
    baseUrl: settings.ollamaBaseUrl,
    model: settings.ollamaModel,
    messages,
  });

  return {
    answer: answer.trim(),
    sources: relevant.map(({ record, score }) => ({
      id: record.id,
      subject: record.subject,
      author: record.author,
      date: record.date,
      folder: record.folder,
      score: Math.round(score * 100) / 100,
    })),
  };
}
