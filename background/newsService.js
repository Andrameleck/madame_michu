// Flash d'actualite autonome : aucun mail, rapport ou historique de chat n'est
// transmis. Les titres proviennent du flux Atom public de The Conversation FR.

const DEFAULT_NEWS_FEED_URL = "https://theconversation.com/fr/articles.atom";
const NEWS_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const NEWS_REQUEST_TIMEOUT_MS = 12_000;
const NEWS_TOPIC_TERMS = {
  science: ["science", "recherche", "santé", "sante", "médecine", "medecine"],
  technology: ["technologie", "numérique", "numerique", "intelligence artificielle", " ia ", "informatique"],
  environment: ["climat", "environnement", "écologie", "ecologie", "biodiversité", "biodiversite", "énergie", "energie"],
  society: ["société", "societe", "éducation", "education", "culture", "politique"],
  economy: ["économie", "economie", "entreprise", "travail", "finance"],
  international: ["international", "europe", "monde", "géopolitique", "geopolitique"],
};

function decodeNewsEntities(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseNewsFeed(xml, feedUrl = DEFAULT_NEWS_FEED_URL) {
  const raw = String(xml || "");
  const withoutItems = raw.replace(/<(?:entry|item)\b[\s\S]*?<\/(?:entry|item)>/gi, "");
  const source = decodeNewsEntities(withoutItems.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1])
    || new URL(feedUrl).hostname.replace(/^www\./, "");
  const blocks = [...raw.matchAll(/<(entry|item)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  return blocks.map((entry) => {
    const title = decodeNewsEntities(entry.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
    const atomLink = entry.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
    const rssLink = entry.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1];
    const link = atomLink || decodeNewsEntities(rssLink);
    const publishedAt = entry.match(/<(?:published|updated|pubDate)\b[^>]*>([^<]+)</i)?.[1] || "";
    const categories = [...entry.matchAll(/<category\b[^>]*(?:term=["']([^"']+)["'][^>]*>|>([\s\S]*?)<\/category>)/gi)]
      .map((match) => decodeNewsEntities(match[1] || match[2]));
    return {
      title,
      url: decodeNewsEntities(link),
      publishedAt,
      categories,
      source,
    };
  }).filter((item) => item.title && /^https:\/\//.test(item.url));
}

function filterNewsByTopics(items, topics) {
  const selected = Array.isArray(topics) ? topics.filter((topic) => NEWS_TOPIC_TERMS[topic]) : [];
  if (!selected.length) return items;
  const filtered = items.filter((item) => {
    const haystack = ` ${item.title} ${(item.categories || []).join(" ")} `.toLocaleLowerCase("fr");
    return selected.some((topic) => NEWS_TOPIC_TERMS[topic].some((term) => haystack.includes(term)));
  });
  return filtered;
}

async function refreshNewsFlash({ force = false } = {}) {
  const settings = await getSettings();
  const feedUrl = String(settings.newsFeedUrl || DEFAULT_NEWS_FEED_URL).trim();
  const feedOrigin = `${new URL(feedUrl).origin}/*`;
  if (messenger.permissions?.contains) {
    const permitted = await messenger.permissions.contains({ origins: [feedOrigin] });
    if (!permitted) {
      throw new Error("Acces au canal RSS non autorise. Enregistre de nouveau les options pour l'accorder.");
    }
  }
  const stored = await messenger.storage.local.get({ lastNewsFlash: null });
  const cached = stored.lastNewsFlash;
  const age = Date.now() - new Date(cached?.fetchedAt || 0).getTime();
  if (!force && cached?.feedUrl === feedUrl && age < NEWS_CACHE_MAX_AGE_MS) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_REQUEST_TIMEOUT_MS);
  try {
    const headers = {};
    if (cached?.feedUrl === feedUrl && cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.feedUrl === feedUrl && cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;
    const response = await fetch(feedUrl, { signal: controller.signal, credentials: "omit", headers });
    if (response.status === 304 && cached?.feedUrl === feedUrl) {
      const revalidated = { ...cached, fetchedAt: new Date().toISOString(), stale: false };
      await messenger.storage.local.set({ lastNewsFlash: revalidated });
      return revalidated;
    }
    if (!response.ok) throw new Error(`Le flux d'actualite a repondu HTTP ${response.status}.`);
    const parsedItems = parseNewsFeed(await response.text(), feedUrl);
    const items = filterNewsByTopics(parsedItems, settings.newsTopics)
      .slice(0, 12);
    const result = {
      fetchedAt: new Date().toISOString(),
      source: items[0]?.source || new URL(feedUrl).hostname,
      feedUrl,
      items,
      etag: response.headers?.get?.("etag") || "",
      lastModified: response.headers?.get?.("last-modified") || "",
    };
    await messenger.storage.local.set({ lastNewsFlash: result });
    return result;
  } catch (error) {
    if (cached?.feedUrl === feedUrl && cached?.items?.length) return { ...cached, stale: true };
    if (error?.name === "AbortError") throw new Error("Le flux d'actualite ne repond pas dans le delai imparti.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
