// Bulletin exterieur optionnel : meteo Open-Meteo et actualites GDELT.
// Seuls la ville et quelques mots-cles sont transmis ; aucun corps de mail.

const EXTERNAL_REQUEST_TIMEOUT_MS = 12_000;
const EXTERNAL_NEWS_STOPWORDS = new Set([
  "avec", "pour", "dans", "sans", "sous", "chez", "entre", "depuis", "avant", "apres",
  "objet", "message", "mail", "merci", "bonjour", "reponse", "information", "informations",
  "presentation", "reunion", "compte", "rendu", "suite", "projet", "point", "mise", "jour",
  "the", "and", "from", "your", "this", "that", "meeting", "update", "newsletter",
]);

async function fetchExternalJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function extractNewsTopics(emails, configuredTopics = [], limit = 4) {
  const counts = new Map();
  for (const topic of configuredTopics) {
    const clean = String(topic || "").trim();
    if (clean) counts.set(clean, 1000);
  }
  for (const email of emails || []) {
    const words = String(email.subject || "")
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .match(/[a-z][a-z0-9-]{3,}/g) || [];
    for (const word of new Set(words)) {
      if (EXTERNAL_NEWS_STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([topic]) => topic);
}

function weatherCodeLabel(code) {
  if (code === 0) return "ciel degage";
  if ([1, 2, 3].includes(code)) return "ciel partiellement nuageux";
  if ([45, 48].includes(code)) return "brouillard";
  if (code >= 51 && code <= 67) return "pluie";
  if (code >= 71 && code <= 77) return "neige";
  if (code >= 80 && code <= 82) return "averses";
  if (code >= 95) return "orage";
  return "conditions variables";
}

async function fetchWeather(location) {
  if (!String(location || "").trim()) return null;
  const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodingUrl.searchParams.set("name", location.trim());
  geocodingUrl.searchParams.set("count", "1");
  geocodingUrl.searchParams.set("language", "fr");
  const geocoding = await fetchExternalJson(geocodingUrl.href);
  const place = geocoding.results?.[0];
  if (!place) throw new Error(`Ville introuvable : ${location}`);

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", place.latitude);
  forecastUrl.searchParams.set("longitude", place.longitude);
  forecastUrl.searchParams.set("timezone", "auto");
  forecastUrl.searchParams.set("forecast_days", "2");
  forecastUrl.searchParams.set(
    "daily",
    "weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max,wind_speed_10m_max"
  );
  const forecast = await fetchExternalJson(forecastUrl.href);
  return {
    location: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    days: (forecast.daily?.time || []).map((date, index) => ({
      date,
      condition: weatherCodeLabel(forecast.daily.weather_code?.[index]),
      min: forecast.daily.temperature_2m_min?.[index],
      max: forecast.daily.temperature_2m_max?.[index],
      rainProbability: forecast.daily.precipitation_probability_max?.[index],
      windMax: forecast.daily.wind_speed_10m_max?.[index],
    })),
    sourceUrl: "https://open-meteo.com/",
  };
}

async function fetchNews(topics) {
  const focusTerms = [...topics, "France", "Europe", "international"]
    .map((topic) => String(topic || "").trim())
    .filter(Boolean)
    .slice(0, 7);
  const query = `(${focusTerms.map((topic) => `\"${topic.replace(/[\"()]/g, "")}\"`).join(" OR ")}) sourcelang:french`;
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", "8");
  url.searchParams.set("timespan", "1d");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("format", "json");
  const data = await fetchExternalJson(url.href);
  return (data.articles || []).filter((article) => /^https:\/\//i.test(article.url || "")).map((article) => ({
    title: String(article.title || "Sans titre").slice(0, 500),
    url: article.url,
    domain: article.domain || new URL(article.url).hostname,
    date: article.seendate || "",
  }));
}

async function fetchExternalBrief(settings, emails = []) {
  if (!settings.externalBriefEnabled) return null;
  const topics = extractNewsTopics(emails, settings.externalNewsTopics || []);
  const [weatherResult, newsResult] = await Promise.allSettled([
    fetchWeather(settings.weatherLocation),
    fetchNews(topics),
  ]);
  return {
    fetchedAt: new Date().toISOString(),
    topics,
    weather: weatherResult.status === "fulfilled" ? weatherResult.value : null,
    weatherError: weatherResult.status === "rejected" ? weatherResult.reason?.message : "",
    news: newsResult.status === "fulfilled" ? newsResult.value : [],
    newsError: newsResult.status === "rejected" ? newsResult.reason?.message : "",
  };
}

function externalBriefFingerprint(brief) {
  if (!brief) return "disabled";
  return JSON.stringify({
    topics: brief.topics,
    weather: brief.weather,
    news: brief.news,
  });
}
