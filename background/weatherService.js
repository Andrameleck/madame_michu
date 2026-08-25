// Meteo autonome de la sidebar. Ce module ne recoit ni mails, ni rapports, ni
// historique de chat : seule la ville fixe de Montpellier est transmise a Open-Meteo.

const WEATHER_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const WEATHER_REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_WEATHER_LOCATION = "Montpellier, France";

function weatherLabel(code, language = "fr") {
  const english = language === "en";
  if (code === 0) return english ? "Clear sky" : "Ciel degage";
  if ([1, 2, 3].includes(code)) return english ? "Partly cloudy" : "Partiellement nuageux";
  if ([45, 48].includes(code)) return english ? "Fog" : "Brouillard";
  if (code >= 51 && code <= 67) return english ? "Rain" : "Pluie";
  if (code >= 71 && code <= 77) return english ? "Snow" : "Neige";
  if (code >= 80 && code <= 82) return english ? "Showers" : "Averses";
  if (code >= 95) return english ? "Thunderstorms" : "Orages";
  return english ? "Changeable" : "Variable";
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

// Selectionne le point horaire le plus proche de H+5. La tendance reste donc
// utile sans transformer le bandeau en prevision detaillee.
function getWeatherTrend(hourly, currentTime, language, hoursAhead = 5) {
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const codes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
  const temperatures = Array.isArray(hourly?.temperature_2m) ? hourly.temperature_2m : [];
  const currentTimestamp = new Date(currentTime || Date.now()).getTime();
  const targetTimestamp = currentTimestamp + (hoursAhead * 60 * 60 * 1000);
  let selectedIndex = -1;
  let smallestDistance = Number.POSITIVE_INFINITY;

  times.forEach((time, index) => {
    const timestamp = new Date(time).getTime();
    if (!Number.isFinite(timestamp) || timestamp < currentTimestamp) return;
    const distance = Math.abs(timestamp - targetTimestamp);
    if (distance < smallestDistance) {
      smallestDistance = distance;
      selectedIndex = index;
    }
  });
  if (selectedIndex < 0 || !Number.isFinite(codes[selectedIndex])) return null;
  return {
    time: times[selectedIndex],
    icon: weatherIcon(codes[selectedIndex]),
    condition: weatherLabel(codes[selectedIndex], language),
    temperature: temperatures[selectedIndex],
  };
}

async function fetchWeatherJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEATHER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error(`Open-Meteo a repondu HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Open-Meteo ne repond pas dans le delai imparti.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestWeather(location, language) {
  const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodingUrl.searchParams.set("name", location);
  geocodingUrl.searchParams.set("count", "1");
  geocodingUrl.searchParams.set("language", language === "en" ? "en" : "fr");
  const geocoding = await fetchWeatherJson(geocodingUrl.href);
  const place = geocoding.results?.[0];
  if (!place) throw new Error(`Ville introuvable : ${location}`);

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", place.latitude);
  forecastUrl.searchParams.set("longitude", place.longitude);
  forecastUrl.searchParams.set("timezone", "auto");
  forecastUrl.searchParams.set("forecast_days", "2");
  forecastUrl.searchParams.set("current", "temperature_2m,weather_code,pressure_msl");
  forecastUrl.searchParams.set("hourly", "temperature_2m,weather_code");
  forecastUrl.searchParams.set("daily", "weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max");
  const forecast = await fetchWeatherJson(forecastUrl.href);
  const current = forecast.current || {};
  const today = forecast.daily || {};
  const code = current.weather_code;
  return {
    fetchedAt: new Date().toISOString(),
    location: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    icon: weatherIcon(code),
    condition: weatherLabel(code, language),
    temperature: current.temperature_2m,
    pressure: current.pressure_msl,
    min: today.temperature_2m_min?.[0],
    max: today.temperature_2m_max?.[0],
    rainProbability: today.precipitation_probability_max?.[0],
    trend: getWeatherTrend(forecast.hourly, current.time, language),
    sourceUrl: "https://open-meteo.com/",
  };
}

async function getSidebarWeather({ force = false } = {}) {
  const settings = await getSettings();
  const location = DEFAULT_WEATHER_LOCATION;
  const stored = await messenger.storage.local.get({ lastWeather: null });
  const cached = stored.lastWeather;
  const cacheAge = Date.now() - new Date(cached?.fetchedAt || 0).getTime();
  if (!force && cached?.requestedLocation === location && cacheAge < WEATHER_CACHE_MAX_AGE_MS) {
    return cached;
  }
  const weather = {
    ...(await requestWeather(location, settings.uiLanguage)),
    status: "ready",
    requestedLocation: location,
  };
  await messenger.storage.local.set({ lastWeather: weather });
  return weather;
}
