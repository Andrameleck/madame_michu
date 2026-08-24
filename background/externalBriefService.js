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

function weatherCodeLabel(code, language = "fr") {
  const en = language === "en";
  if (code === 0) return en ? "clear skies" : "ciel degage";
  if ([1, 2, 3].includes(code)) return en ? "partly cloudy" : "ciel partiellement nuageux";
  if ([45, 48].includes(code)) return en ? "fog" : "brouillard";
  if (code >= 51 && code <= 67) return en ? "rain" : "pluie";
  if (code >= 71 && code <= 77) return en ? "snow" : "neige";
  if (code >= 80 && code <= 82) return en ? "showers" : "averses";
  if (code >= 95) return en ? "storms" : "orage";
  return en ? "changeable conditions" : "conditions variables";
}

function weatherIcon(code) {
  if (code === 0) return "☀️";
  if ([1, 2, 3].includes(code)) return "⛅";
  if ([45, 48].includes(code)) return "🌫️";
  if (code >= 51 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "🌨️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 95) return "⛈️";
  return "🌡️";
}

// Petit aperçu de l'evolution du ciel dans les prochaines heures (carte meteo de
// la sidebar) : on choisit l'heure la plus proche de +5h dans les previsions
// horaires deja recuperees, pas d'appel reseau supplementaire.
function buildWeatherTrend(hourly, nowIso, language = "fr") {
  const times = hourly?.time || [];
  if (!times.length) return null;
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();
  const targetMs = now + 5 * 60 * 60 * 1000;
  let bestIndex = -1;
  let bestDiff = Infinity;
  times.forEach((time, index) => {
    const diff = Math.abs(new Date(time).getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });
  if (bestIndex === -1) return null;
  const code = hourly.weather_code?.[bestIndex];
  return {
    time: times[bestIndex],
    temperature: hourly.temperature_2m?.[bestIndex],
    condition: weatherCodeLabel(code, language),
    icon: weatherIcon(code),
  };
}

async function fetchWeather(location, language = "fr") {
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
  forecastUrl.searchParams.set("current", "temperature_2m,weather_code,pressure_msl");
  forecastUrl.searchParams.set("hourly", "temperature_2m,weather_code");
  const forecast = await fetchExternalJson(forecastUrl.href);
  const current = forecast.current ? {
    temperature: forecast.current.temperature_2m,
    condition: weatherCodeLabel(forecast.current.weather_code, language),
    icon: weatherIcon(forecast.current.weather_code),
    pressure: forecast.current.pressure_msl,
  } : null;
  return {
    location: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    current,
    trend: buildWeatherTrend(forecast.hourly, forecast.current?.time, language),
    days: (forecast.daily?.time || []).map((date, index) => ({
      date,
      condition: weatherCodeLabel(forecast.daily.weather_code?.[index], language),
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
  const language = settings.uiLanguage === "en" ? "en" : "fr";
  const topics = extractNewsTopics(emails, settings.externalNewsTopics || []);
  const [weatherResult, newsResult] = await Promise.allSettled([
    fetchWeather(settings.weatherLocation, language),
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

// Resume texte court, cote serieux : uniquement les actualites (la meteo a sa
// propre carte dans la sidebar, pas besoin de la repeter en prose).
function formatExternalNewsOverview(brief, language = "fr") {
  if (!brief?.news?.length) return "";
  const en = language === "en";
  const headlines = brief.news.slice(0, 2)
    .map((article) => (en ? `"${article.title}" (${article.domain})` : `« ${article.title} » (${article.domain})`))
    .join(en ? " and " : " et ");
  return en ? `In the news: ${headlines}.` : `A la une : ${headlines}.`;
}

function externalBriefFingerprint(brief) {
  if (!brief) return "disabled";
  // La meteo "actuelle"/tendance change en continu : l'exclure du fingerprint
  // evite de forcer une regeneration LLM a chaque rafraichissement silencieux
  // alors que rien de pertinent (mails, previsions du jour, actus) n'a change.
  return JSON.stringify({
    topics: brief.topics,
    weatherDays: brief.weather?.days,
    news: brief.news,
  });
}
