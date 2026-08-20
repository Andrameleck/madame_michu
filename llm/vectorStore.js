// Stockage local (IndexedDB) des embeddings de mails, pour la recherche
// semantique utilisee par le chatbot. Persiste entre redemarrages de
// Thunderbird tant que l'extension reste installee.

const VECTOR_DB_NAME = "assistant-mail-ia-vectors";
const VECTOR_DB_VERSION = 1;
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
    .map((record) => ({ record, score: cosineSimilarity(queryEmbedding, record.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
