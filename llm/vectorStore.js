// Stockage local (IndexedDB) des embeddings de mails, pour la recherche
// semantique utilisee par le chatbot. Persiste entre redemarrages de
// Thunderbird tant que l'extension reste installee.

const VECTOR_DB_NAME = "assistant-mail-ia-vectors";
const VECTOR_DB_VERSION = 2;
const VECTOR_STORE_NAME = "mailVectors";

let dbPromise = null;
// L'index tient en memoire une seule fois : recharger IndexedDB a chaque
// recherche recopiait tous les embeddings (structured clone) plusieurs fois par
// question. Le cache est invalide par upsertVector/clearVectors, seuls points
// d'ecriture du store.
let preparedIndex = null;

function openVectorDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(VECTOR_DB_NAME, VECTOR_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VECTOR_STORE_NAME)) {
        db.createObjectStore(VECTOR_STORE_NAME, { keyPath: "id" });
      } else {
        // La v1 utilisait les IDs numeriques ephemeres de Thunderbird. Ils sont
        // invalides apres redemarrage, donc une migration fiable impose de
        // reconstruire l'index avec les Message-ID persistants.
        request.transaction.objectStore(VECTOR_STORE_NAME).clear();
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function upsertVector(record) {
  const db = await openVectorDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VECTOR_STORE_NAME, "readwrite");
    tx.objectStore(VECTOR_STORE_NAME).put(record);
    tx.oncomplete = () => {
      if (preparedIndex) preparedIndex.set(record.id, prepareVectorEntry(record));
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function readAllVectorsFromDb() {
  const db = await openVectorDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VECTOR_STORE_NAME, "readonly");
    const request = tx.objectStore(VECTOR_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function getAllVectorIds() {
  const db = await openVectorDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VECTOR_STORE_NAME, "readonly");
    const request = tx.objectStore(VECTOR_STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve(new Set(request.result || []));
    request.onerror = () => reject(request.error);
  });
}

async function countVectors() {
  const db = await openVectorDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VECTOR_STORE_NAME, "readonly");
    const request = tx.objectStore(VECTOR_STORE_NAME).count();
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
  });
}

async function clearVectors() {
  const db = await openVectorDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VECTOR_STORE_NAME, "readwrite");
    tx.objectStore(VECTOR_STORE_NAME).clear();
    tx.oncomplete = () => {
      preparedIndex = new Map();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

const LEXICAL_STOP_WORDS = new Set([
  "avec", "dans", "des", "les", "pour", "que", "qui", "sur", "une", "est",
  "sont", "aux", "par", "pas", "plus", "mail", "mails", "quoi", "comment",
]);

function lexicalTerms(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 2 && !LEXICAL_STOP_WORDS.has(term));
}

// Radical grossier : « contrat » et « contrats » partagent le meme prefixe, ce
// qui restitue la tolerance aux flexions que donnait l'ancienne recherche par
// sous-chaine, sans son effet de bord (« art » trouvait « article »).
const LEXICAL_STEM_LENGTH = 5;

function lexicalStem(term) {
  return term.length > LEXICAL_STEM_LENGTH ? term.slice(0, LEXICAL_STEM_LENGTH) : term;
}

function tokenSets(text) {
  const tokens = new Set();
  const stems = new Set();
  for (const term of lexicalTerms(text)) {
    tokens.add(term);
    stems.add(lexicalStem(term));
  }
  return { tokens, stems };
}

// Pre-calcule tout ce qui ne depend pas de la question : tokens lexicaux,
// vecteur en Float32Array et sa norme. Sans cela, chaque question re-tokenisait
// l'integralite des extraits et recalculait la norme de chaque vecteur.
function prepareVectorEntry(record) {
  const embedding = Array.isArray(record.embedding) && record.embedding.length
    ? Float32Array.from(record.embedding)
    : null;
  let norm = 0;
  if (embedding) {
    for (let i = 0; i < embedding.length; i++) norm += embedding[i] * embedding[i];
    norm = Math.sqrt(norm);
  }
  return {
    record,
    embedding: norm > 0 ? embedding : null,
    norm,
    subject: tokenSets(record.subject),
    content: tokenSets(`${record.author} ${record.subject} ${record.excerpt}`),
  };
}

async function getPreparedIndex() {
  if (!preparedIndex) {
    const records = await readAllVectorsFromDb();
    preparedIndex = new Map(records.map((record) => [record.id, prepareVectorEntry(record)]));
  }
  return preparedIndex;
}

async function getAllVectors() {
  return [...(await getPreparedIndex()).values()].map((entry) => entry.record);
}

function topScored(scored, topK) {
  return scored.sort((left, right) => right.score - left.score).slice(0, topK);
}

// Retourne les topK enregistrements les plus proches du vecteur donne.
async function searchSimilar(queryEmbedding, topK) {
  const query = Array.isArray(queryEmbedding) || ArrayBuffer.isView(queryEmbedding)
    ? Float32Array.from(queryEmbedding)
    : null;
  let queryNorm = 0;
  if (query) {
    for (let i = 0; i < query.length; i++) queryNorm += query[i] * query[i];
    queryNorm = Math.sqrt(queryNorm);
  }
  if (!queryNorm) return [];

  const scored = [];
  for (const entry of (await getPreparedIndex()).values()) {
    if (!entry.embedding) continue;
    const len = Math.min(query.length, entry.embedding.length);
    let dot = 0;
    for (let i = 0; i < len; i++) dot += query[i] * entry.embedding[i];
    scored.push({ record: entry.record, score: dot / (queryNorm * entry.norm) });
  }
  return topScored(scored, topK);
}

function termScore({ tokens, stems }, term, stem) {
  if (tokens.has(term)) return 1;
  return stems.has(stem) ? 0.5 : 0;
}

async function searchLexical(question, topK) {
  const terms = [...new Set(lexicalTerms(question))];
  if (!terms.length) return [];

  const stems = terms.map(lexicalStem);

  const scored = [];
  for (const entry of (await getPreparedIndex()).values()) {
    let score = 0;
    for (const [index, term] of terms.entries()) {
      score += termScore(entry.content, term, stems[index]);
      score += termScore(entry.subject, term, stems[index]);
    }
    if (!score) continue;
    scored.push({ record: entry.record, score: score / (terms.length * 2) });
  }
  return topScored(scored, topK);
}
