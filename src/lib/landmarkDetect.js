// src/lib/landmarkDetect.js
// Простий детектор визначних місць за текстом (опис + OCR).
// Повертає структурований список та готові Google Maps лінки.
// Може доповнюватися через KV: LANDMARKS_KV -> key "list" (JSON масив у форматі як нижче).

/**
 * Landmark schema:
 * {
 *   name: "Eiffel Tower",
 *   city: "Paris",
 *   country: "France",
 *   lat: 48.85837, lon: 2.29448,
 *   aliases: ["eiffel", "tour eiffel", "эйфелева", "ейфелева", "Ейфелева вежа"]
 * }
 */

const BASE_LANDMARKS = [
  // FR
  { name: "Eiffel Tower", city: "Paris", country: "France", lat: 48.85837, lon: 2.29448,
    aliases: ["eiffel tower","tour eiffel","ейфелева вежа","эйфелева башня","eiffel"] },
  { name: "Louvre Museum", city: "Paris", country: "France", lat: 48.86061, lon: 2.33764,
    aliases: ["louvre","musée du louvre","лувр"] },
  { name: "Notre-Dame de Paris", city: "Paris", country: "France", lat: 48.853, lon: 2.3499,
    aliases: ["notre-dame","notre dame","нотр-дам","собор паризької богоматері"] },

  // DE
  { name: "Brandenburg Gate", city: "Berlin", country: "Germany", lat: 52.51628, lon: 13.37770,
    aliases: ["brandenburg gate","brandenburger tor","брандебурзькі ворота","бранденбургские ворота"] },
  { name: "Reichstag Building", city: "Berlin", country: "Germany", lat: 52.51862, lon: 13.37618,
    aliases: ["reichstag","рейхстаг"] },
  { name: "Berlin TV Tower", city: "Berlin", country: "Germany", lat: 52.52082, lon: 13.40945,
    aliases: ["berlin tv tower","fernsehturm","телевежа берлін","берлинская телевышка"] },
  { name: "Cologne Cathedral", city: "Cologne", country: "Germany", lat: 50.94128, lon: 6.95828,
    aliases: ["cologne cathedral","kölner dom","кельнський собор","кельнский собор"] },

  // ES
  { name: "Sagrada Família", city: "Barcelona", country: "Spain", lat: 41.40363, lon: 2.17436,
    aliases: ["sagrada familia","sagrada família","саграда фамілія","саграда фамилия"] },

  // IT
  { name: "Colosseum", city: "Rome", country: "Italy", lat: 41.89021, lon: 12.49223,
    aliases: ["colosseum","колізей","колизей","colosseo"] },
  { name: "Leaning Tower of Pisa", city: "Pisa", country: "Italy", lat: 43.7230, lon: 10.3966,
    aliases: ["leaning tower","torre di pisa","пізанська вежа","пизанская башня"] },

  // UK
  { name: "Big Ben (Elizabeth Tower)", city: "London", country: "United Kingdom", lat: 51.50073, lon: -0.12463,
    aliases: ["big ben","елізабет тауер","биг бен"] },
  { name: "Tower Bridge", city: "London", country: "United Kingdom", lat: 51.50546, lon: -0.07540,
    aliases: ["tower bridge","тауер-бридж","таверський міст","тавер бридж"] },
  { name: "Buckingham Palace", city: "London", country: "United Kingdom", lat: 51.50136, lon: -0.14189,
    aliases: ["buckingham palace","букингемський палац","букингемский дворец"] },

  // UA
  { name: "Saint Sophia Cathedral", city: "Kyiv", country: "Ukraine", lat: 50.4526, lon: 30.5145,
    aliases: ["софія київська","софия киевская","saint sophia cathedral kyiv"] },
  { name: "Golden Gate", city: "Kyiv", country: "Ukraine", lat: 50.4482, lon: 30.5133,
    aliases: ["золоті ворота","золотые ворота киев","golden gate kyiv"] },
  { name: "Motherland Monument", city: "Kyiv", country: "Ukraine", lat: 50.4260, lon: 30.5635,
    aliases: ["батьківщина-мати","родина-мать","motherland monument kyiv"] },
  { name: "Lviv Theatre of Opera and Ballet", city: "Lviv", country: "Ukraine", lat: 49.8441, lon: 24.0265,
    aliases: ["львівська опера","львовская опера","lviv opera"] },

  // CZ/PL/AT
  { name: "Charles Bridge", city: "Prague", country: "Czechia", lat: 50.0865, lon: 14.4114,
    aliases: ["charles bridge","карлів міст","карлов мост"] },
  { name: "Wawel Royal Castle", city: "Kraków", country: "Poland", lat: 50.0541, lon: 19.9366,
    aliases: ["wawel castle","вாவель","вабель","вaвель"] },
  { name: "Schönbrunn Palace", city: "Vienna", country: "Austria", lat: 48.1845, lon: 16.3122,
    aliases: ["schonbrunn","schönbrunn palace","шенбрунн","шенбрун"] },
];

// ── Утиліти ─────────────────────────────────────────────────────────────────
const DIACRITICS = /[\u0300-\u036f]/g;
function normalize(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/[“”«»„’']/g, "'")
    .replace(/[^a-zа-яёїієґ0-9' \-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Побудувати лінк Google Maps
export function mapsLink(obj) {
  const { name, city, country, lat, lon } = obj || {};
  if (typeof lat === "number" && typeof lon === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
  }
  const q = [name, city, country].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// Завантажити додаткові лендмарки з KV (необов'язково)
let _cachedExtra = null;
async function loadExtraFromKV(env) {
  if (!env?.LANDMARKS_KV) return [];
  if (_cachedExtra) return _cachedExtra;
  try {
    const raw = await env.LANDMARKS_KV.get("list");
    if (!raw) return (_cachedExtra = []);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return (_cachedExtra = []);
    // sanitize
    _cachedExtra = arr
      .map((x) => ({
        name: String(x?.name || "").trim(),
        city: String(x?.city || "").trim(),
        country: String(x?.country || "").trim(),
        lat: typeof x?.lat === "number" ? x.lat : null,
        lon: typeof x?.lon === "number" ? x.lon : null,
        aliases: Array.isArray(x?.aliases) ? x.aliases.map((a) => String(a || "").toLowerCase()) : []
      }))
      .filter((x) => x.name && (x.aliases?.length || x.lat != null));
    return _cachedExtra;
  } catch {
    return (_cachedExtra = []);
  }
}