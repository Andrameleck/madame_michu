// Stockage local (IndexedDB) des embeddings de mails, pour la recherche
// semantique utilisee par le chatbot. Persiste entre redemarrages de
// Thunderbird tant que l'extension reste installee.

const VECTOR_DB_NAME = "assistant-mail-ia-vectors";
const VECTOR_DB_VERSION = 2;
const VECTOR_STORE_NAME = "mailVectors";

let dbPromise = null;

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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllVectors() {
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Retourne les topK enregistrements les plus proches du vecteur donne.
async function searchSimilar(queryEmbedding, topK) {
  const all = await getAllVectors();
  return all
    .filter((record) => Array.isArray(record.embedding) && record.embedding.length)
    .map((record) => ({ record, score: cosineSimilarity(queryEmbedding, record.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
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

async function searchLexical(question, topK) {
  const terms = [...new Set(lexicalTerms(question))];
  if (!terms.length) return [];
  const all = await getAllVectors();
  return all
    .map((record) => {
      const subject = lexicalTerms(record.subject).join(" ");
      const content = lexicalTerms(
        `${record.author} ${record.subject} ${record.excerpt}`
      ).join(" ");
      const matches = terms.filter((term) => content.includes(term)).length;
      const subjectMatches = terms.filter((term) => subject.includes(term)).length;
      return { record, score: (matches + subjectMatches) / (terms.length * 2) };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
