const DATASET_BASE_URL =
  "https://dataeducation.opendatasoft.com/api/explore/v2.1/catalog/datasets/fr-en-sport-etudes/records";
const DATASET_PAGE_SIZE = 100;
const OSM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const RESULT_COUNT = 10;
const AUTOCOMPLETE_LIMIT = 6;
const AUTOCOMPLETE_MIN_CHARS = 2;
const AUTOCOMPLETE_DEBOUNCE_MS = 220;

const form = document.getElementById("search-form");
const addressInput = document.getElementById("address");
const suggestionsEl = document.getElementById("suggestions");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

let selectedPlace = null;
let currentSuggestions = [];
let suggestionAbortController = null;
let inputDebounceTimer = null;
const suggestionCache = new Map();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideSuggestions();

  const address = addressInput.value.trim();
  if (!address) {
    setStatus("Veuillez saisir une adresse.");
    return;
  }

  setLoading(true);
  clearResults();

  try {
    setStatus("Géocodage de l'adresse...");
    const userPosition = await getUserPosition(address);

    setStatus("Chargement des établissements...");
    const institutions = await fetchInstitutions();

    if (!institutions.length) {
      setStatus("Aucune donnée d'établissement disponible.");
      return;
    }

    const nearest = institutions
      .map((item) => ({
        ...item,
        distanceKm: haversineKm(
          userPosition.lat,
          userPosition.lon,
          item.position.lat,
          item.position.lon
        ),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, RESULT_COUNT);

    renderResults(nearest);
    setStatus(
      `${nearest.length} établissement(s) les plus proches de « ${userPosition.label} ».`
    );
  } catch (error) {
    setStatus(error.message || "Une erreur est survenue.");
  } finally {
    setLoading(false);
  }
});

addressInput.addEventListener("input", () => {
  selectedPlace = null;
  const query = addressInput.value.trim();

  if (inputDebounceTimer) {
    clearTimeout(inputDebounceTimer);
  }

  if (query.length < AUTOCOMPLETE_MIN_CHARS) {
    hideSuggestions();
    return;
  }

  inputDebounceTimer = setTimeout(() => {
    fetchAddressSuggestions(query).catch((error) => {
      if (error.name !== "AbortError") {
        hideSuggestions();
      }
    });
  }, AUTOCOMPLETE_DEBOUNCE_MS);
});

addressInput.addEventListener("blur", () => {
  setTimeout(() => {
    hideSuggestions();
  }, 120);
});

addressInput.addEventListener("focus", () => {
  if (currentSuggestions.length) {
    showSuggestions();
  }
});

suggestionsEl.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("button[data-index]");
  if (!button) {
    return;
  }

  const place = currentSuggestions[Number(button.dataset.index)];
  if (!place) {
    return;
  }

  event.preventDefault();
  selectPlace(place);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".autocomplete-wrap")) {
    hideSuggestions();
  }
});

async function getUserPosition(address) {
  if (selectedPlace && selectedPlace.label === address) {
    return selectedPlace;
  }

  const exactMatch = currentSuggestions.find((place) => place.label === address);
  if (exactMatch) {
    return exactMatch;
  }

  return geocodeAddress(address);
}

async function fetchAddressSuggestions(query) {
  const cacheKey = query.toLowerCase();

  if (suggestionCache.has(cacheKey)) {
    currentSuggestions = suggestionCache.get(cacheKey);
    renderSuggestions(currentSuggestions);
    return;
  }

  if (suggestionAbortController) {
    suggestionAbortController.abort();
  }

  suggestionAbortController = new AbortController();
  const places = await searchNominatim(
    query,
    AUTOCOMPLETE_LIMIT,
    suggestionAbortController.signal
  );

  suggestionCache.set(cacheKey, places);
  currentSuggestions = places;
  renderSuggestions(currentSuggestions);
}

async function geocodeAddress(address) {
  const places = await searchNominatim(address, 1);
  const first = places[0];

  if (!first) {
    throw new Error("Adresse introuvable. Essayez une adresse plus précise en France.");
  }

  return first;
}

async function searchNominatim(query, limit, signal) {
  const url = new URL(OSM_SEARCH_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "fr");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("accept-language", "fr");
  url.searchParams.set("q", query);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error("Échec de la recherche d'adresses.");
  }

  const data = await response.json();
  return data.map((item) => ({
    lat: Number(item.lat),
    lon: Number(item.lon),
    label: item.display_name,
  }));
}

function renderSuggestions(places) {
  suggestionsEl.innerHTML = "";

  if (!places.length) {
    hideSuggestions();
    return;
  }

  places.forEach((place, index) => {
    const li = document.createElement("li");
    li.className = "suggestion-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-btn";
    button.dataset.index = String(index);
    button.textContent = place.label;

    li.appendChild(button);
    suggestionsEl.appendChild(li);
  });

  showSuggestions();
}

function selectPlace(place) {
  selectedPlace = place;
  addressInput.value = place.label;
  hideSuggestions();
}

function hideSuggestions() {
  suggestionsEl.classList.add("hidden");
}

function showSuggestions() {
  suggestionsEl.classList.remove("hidden");
}

async function fetchInstitutions() {
  let offset = 0;
  let totalCount = Infinity;
  const allResults = [];

  while (offset < totalCount) {
    const url = `${DATASET_BASE_URL}?limit=${DATASET_PAGE_SIZE}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Échec du chargement des établissements.");
    }

    const data = await response.json();
    totalCount = data.total_count || 0;
    const pageResults = data.results || [];

    allResults.push(...pageResults);
    offset += DATASET_PAGE_SIZE;

    if (!pageResults.length) {
      break;
    }
  }

  return allResults.filter((item) => item.position?.lat && item.position?.lon);
}

function renderResults(items) {
  clearResults();

  if (!items.length) {
    setStatus("Aucun établissement à proximité trouvé.");
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "result-item";

    const type = item.type_etablissement || "Autre";
    const typeClass = getTypeClass(type);
    const sportsChips = renderSportsChips(item.pratique_proposee);

    li.innerHTML = `
      <h2>${escapeHtml(item.nom_etablissement || "Établissement inconnu")}</h2>
      <p class="meta"><strong>Distance :</strong> ${formatDistance(item.distanceKm)}</p>
      <p class="meta inline-row"><strong>Type :</strong> <span class="badge ${typeClass}">${escapeHtml(
      type
    )}</span></p>
      <p class="meta"><strong>Localisation :</strong> ${escapeHtml(
        `${item.nom_commune || "-"}, ${item.libelle_departement || "-"}`
      )}</p>
      <div class="meta"><strong>Sports :</strong><div class="chips">${sportsChips}</div></div>
      <div class="links">
        ${item.web ? `<a href="${item.web}" target="_blank" rel="noreferrer">Site web</a>` : ""}
        ${
          item.fiche_onisep
            ? `<a href="${item.fiche_onisep}" target="_blank" rel="noreferrer">Fiche Onisep</a>`
            : ""
        }
      </div>
    `;

    resultsEl.appendChild(li);
  }
}

function getTypeClass(typeLabel) {
  const normalized = normalizeText(typeLabel);
  if (normalized.includes("lycee")) {
    return "badge-type-lycee";
  }
  if (normalized.includes("college")) {
    return "badge-type-college";
  }
  return "badge-type-other";
}

function renderSportsChips(sports) {
  if (!Array.isArray(sports) || !sports.length) {
    return `<span class="chip chip-other">Non renseigné</span>`;
  }

  return sports
    .map((sport) => {
      const category = getSportCategory(sport);
      return `<span class="chip ${category.className}">${escapeHtml(sport)}</span>`;
    })
    .join("");
}

function getSportCategory(sportName) {
  const value = normalizeText(sportName);

  if (
    value.includes("football") ||
    value.includes("basket") ||
    value.includes("handball") ||
    value.includes("rugby") ||
    value.includes("volley") ||
    value.includes("hockey")
  ) {
    return { className: "chip-team" };
  }

  if (
    value.includes("judo") ||
    value.includes("lutte") ||
    value.includes("boxe") ||
    value.includes("karate") ||
    value.includes("taekwondo") ||
    value.includes("escrime")
  ) {
    return { className: "chip-combat" };
  }

  if (
    value.includes("natation") ||
    value.includes("canoe") ||
    value.includes("kayak") ||
    value.includes("aviron") ||
    value.includes("voile") ||
    value.includes("plongee")
  ) {
    return { className: "chip-water" };
  }

  if (
    value.includes("ski") ||
    value.includes("biathlon") ||
    value.includes("snowboard") ||
    value.includes("alpinisme") ||
    value.includes("escalade")
  ) {
    return { className: "chip-winter" };
  }

  if (
    value.includes("athletisme") ||
    value.includes("triathlon") ||
    value.includes("cyclisme") ||
    value.includes("course") ||
    value.includes("marathon")
  ) {
    return { className: "chip-endurance" };
  }

  return { className: "chip-other" };
}

function setLoading(isLoading) {
  const button = form.querySelector("button");
  button.disabled = isLoading;
  button.textContent = isLoading ? "Recherche..." : "Rechercher";
}

function setStatus(message) {
  statusEl.textContent = message;
}

function clearResults() {
  resultsEl.innerHTML = "";
}

function formatDistance(distanceKm) {
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(distanceKm)} km`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
