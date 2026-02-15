const DATASET_CONFIG = {
  sport_etudes: {
    label: "Sport-études",
    endpoint:
      "https://dataeducation.opendatasoft.com/api/explore/v2.1/catalog/datasets/fr-en-sport-etudes/records",
    sportsField: "pratique_proposee",
    sourceClass: "badge-source-sport-etudes",
    marker: { color: "#1d4ed8", fill: "#2563eb" },
  },
  sections_sportives: {
    label: "Sections sportives scolaires",
    endpoint:
      "https://dataeducation.opendatasoft.com/api/explore/v2.1/catalog/datasets/sections-sportives-scolaires/records",
    sportsField: "sections_scolaires",
    sourceClass: "badge-source-sections",
    marker: { color: "#0f766e", fill: "#14b8a6" },
  },
};
const DATASET_PAGE_SIZE = 100;
const OSM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const DEFAULT_RESULT_COUNT = 10;
const DEFAULT_PRESEARCH_PAGE_SIZE = 50;
const AUTOCOMPLETE_LIMIT = 6;
const AUTOCOMPLETE_MIN_CHARS = 2;
const AUTOCOMPLETE_DEBOUNCE_MS = 220;

const form = document.getElementById("search-form");
const addressInput = document.getElementById("address");
const suggestionsEl = document.getElementById("suggestions");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const mapEl = document.getElementById("map");
const filterDatasetEl = document.getElementById("filter-dataset");
const filterTypeEl = document.getElementById("filter-type");
const filterSportEl = document.getElementById("filter-sport");
const filterCountEl = document.getElementById("filter-count");
const clearFiltersBtn = document.getElementById("clear-filters");
const listControlsEl = document.getElementById("list-controls");
const loadMoreBtn = document.getElementById("load-more");

let selectedPlace = null;
let currentSuggestions = [];
let suggestionAbortController = null;
let inputDebounceTimer = null;
const suggestionCache = new Map();
let map = null;
let mapLayerGroup = null;
const datasetCache = new Map();
let latestUserPosition = null;
let latestBaseInstitutions = [];
let listDisplayLimit = DEFAULT_PRESEARCH_PAGE_SIZE;

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
    await loadInstitutionsForCurrentMode(userPosition);
  } catch (error) {
    setStatus(error.message || "Une erreur est survenue.");
  } finally {
    setLoading(false);
  }
});

filterDatasetEl.addEventListener("change", async () => {
  setLoading(true);
  clearResults();

  try {
    listDisplayLimit = DEFAULT_PRESEARCH_PAGE_SIZE;
    await loadInstitutionsForCurrentMode(latestUserPosition);
  } catch (error) {
    setStatus(error.message || "Une erreur est survenue.");
  } finally {
    setLoading(false);
  }
});

filterTypeEl.addEventListener("change", () => {
  if (!latestUserPosition) {
    listDisplayLimit = DEFAULT_PRESEARCH_PAGE_SIZE;
  }
  updateResultsView();
});

filterSportEl.addEventListener("change", () => {
  if (!latestUserPosition) {
    listDisplayLimit = DEFAULT_PRESEARCH_PAGE_SIZE;
  }
  updateResultsView();
});

filterCountEl.addEventListener("change", () => {
  updateResultsView();
});

clearFiltersBtn.addEventListener("click", () => {
  filterDatasetEl.value = "sport_etudes";
  filterTypeEl.value = "all";
  filterSportEl.value = "all";
  filterCountEl.value = String(DEFAULT_RESULT_COUNT);
  listDisplayLimit = DEFAULT_PRESEARCH_PAGE_SIZE;

  setLoading(true);
  clearResults();
  loadInstitutionsForCurrentMode(latestUserPosition)
    .catch((error) => {
      setStatus(error.message || "Une erreur est survenue.");
    })
    .finally(() => {
      setLoading(false);
    });
});

loadMoreBtn.addEventListener("click", () => {
  listDisplayLimit += DEFAULT_PRESEARCH_PAGE_SIZE;
  updateResultsView();
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

async function loadInstitutionsForCurrentMode(userPosition) {
  setStatus("Chargement des établissements...");
  const institutions = await fetchInstitutionsBySelection(getSelectedDatasetKey());

  if (!institutions.length) {
    setStatus("Aucune donnée d'établissement disponible.");
    latestBaseInstitutions = [];
    renderMap(null, []);
    toggleListControls(0, 0);
    return;
  }

  latestUserPosition = userPosition;
  if (userPosition) {
    latestBaseInstitutions = institutions
      .map((item) => ({
        ...item,
        distanceKm: haversineKm(
          userPosition.lat,
          userPosition.lon,
          item.position.lat,
          item.position.lon
        ),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  } else {
    latestBaseInstitutions = [...institutions].sort((a, b) => {
      const nameA = String(a.nom_etablissement || "");
      const nameB = String(b.nom_etablissement || "");
      return nameA.localeCompare(nameB, "fr");
    });
  }

  initializeFilters(institutions);
  updateResultsView();
}

function isDistanceMode() {
  return Boolean(latestUserPosition);
}

function getSelectedDatasetKey() {
  return filterDatasetEl.value;
}

function getSelectedDatasetLabel() {
  const selected = getSelectedDatasetKey();
  if (selected === "all") {
    return "Toutes les sources";
  }
  return DATASET_CONFIG[selected]?.label || "Source inconnue";
}

function initializeFilters(institutions) {
  const previousType = filterTypeEl.value;
  const previousSport = filterSportEl.value;

  const types = Array.from(
    new Set(
      institutions
        .map((item) => (item.type_etablissement || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  const sports = Array.from(
    new Set(
      institutions
        .flatMap((item) => (Array.isArray(item.sports) ? item.sports : []))
        .map((sport) => String(sport).trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  resetAndAppendFilterOptions(filterTypeEl, types);
  resetAndAppendFilterOptions(filterSportEl, sports);

  if (previousType !== "all" && types.includes(previousType)) {
    filterTypeEl.value = previousType;
  }

  if (previousSport !== "all" && sports.includes(previousSport)) {
    filterSportEl.value = previousSport;
  }
}

function resetAndAppendFilterOptions(selectEl, options) {
  selectEl.innerHTML = '<option value="all">Tous</option>';

  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  });
}

function updateResultsView() {
  if (!latestBaseInstitutions.length) {
    return;
  }

  syncModeUi();
  const filteredInstitutions = applyFilters(latestBaseInstitutions);
  const displayLimit = isDistanceMode()
    ? getSelectedResultCount()
    : listDisplayLimit;
  const displayedInstitutions = filteredInstitutions.slice(0, displayLimit);
  const sourceLabel = getSelectedDatasetLabel();

  renderResults(displayedInstitutions);
  renderMap(latestUserPosition, displayedInstitutions);
  toggleListControls(filteredInstitutions.length, displayedInstitutions.length);

  if (!displayedInstitutions.length) {
    setStatus("Aucun établissement trouvé avec les filtres sélectionnés.");
    return;
  }

  if (isDistanceMode()) {
    setStatus(
      `${displayedInstitutions.length} établissement(s) les plus proches de « ${latestUserPosition.label} » (${sourceLabel}).`
    );
    return;
  }

  setStatus(
    `${displayedInstitutions.length}/${filteredInstitutions.length} établissement(s) affiché(s) (${sourceLabel}). Ajoutez une adresse pour trier par distance.`
  );
}

function getSelectedResultCount() {
  const parsed = Number.parseInt(filterCountEl.value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RESULT_COUNT;
  }
  return parsed;
}

function toggleListControls(totalCount, shownCount) {
  if (isDistanceMode()) {
    listControlsEl.classList.add("hidden");
    return;
  }

  const hasMore = shownCount < totalCount;
  loadMoreBtn.classList.toggle("hidden", !hasMore);
  listControlsEl.classList.toggle("hidden", !hasMore);
}

function syncModeUi() {
  const listMode = !isDistanceMode();
  filterCountEl.disabled = listMode;
}

function applyFilters(items) {
  const selectedType = filterTypeEl.value;
  const selectedSport = filterSportEl.value;

  return items.filter((item) => {
    const typeMatch =
      selectedType === "all" || (item.type_etablissement || "") === selectedType;
    const sportMatch =
      selectedSport === "all" ||
      (Array.isArray(item.sports) && item.sports.includes(selectedSport));
    return typeMatch && sportMatch;
  });
}

function ensureMap() {
  if (!mapEl || !window.L) {
    return false;
  }

  if (map) {
    return true;
  }

  map = window.L.map(mapEl, {
    zoomControl: true,
  }).setView([46.603354, 1.888334], 6);

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  mapLayerGroup = window.L.layerGroup().addTo(map);
  return true;
}

function renderMap(userPosition, institutions) {
  if (!ensureMap()) {
    return;
  }

  mapLayerGroup.clearLayers();

  const points = [];
  if (userPosition) {
    const userLatLng = [userPosition.lat, userPosition.lon];
    points.push(userLatLng);

    const userMarker = window.L.circleMarker(userLatLng, {
      radius: 9,
      color: "#1d4ed8",
      fillColor: "#2563eb",
      fillOpacity: 0.95,
      weight: 2,
    }).bindPopup(`<strong>Votre adresse</strong><br>${escapeHtml(userPosition.label)}`);
    userMarker.addTo(mapLayerGroup);
  }

  institutions.forEach((item) => {
    const latLng = [item.position.lat, item.position.lon];
    points.push(latLng);
    const sourceConfig = DATASET_CONFIG[item.datasetKey] || DATASET_CONFIG.sport_etudes;
    const onisepLink = item.fiche_onisep
      ? `<br><a href="${escapeHtml(item.fiche_onisep)}" target="_blank" rel="noreferrer">Fiche Onisep</a>`
      : "";
    const websiteLink = item.web
      ? `<br><a href="${escapeHtml(item.web)}" target="_blank" rel="noreferrer">Site web</a>`
      : "";

    const marker = window.L.circleMarker(latLng, {
      radius: 7,
      color: sourceConfig.marker.color,
      fillColor: sourceConfig.marker.fill,
      fillOpacity: 0.9,
      weight: 2,
    }).bindPopup(
      `<strong>${escapeHtml(item.nom_etablissement || "Établissement")}</strong><br>` +
        `${escapeHtml(item.nom_commune || "-")}, ${escapeHtml(item.libelle_departement || "-")}<br>` +
        `Source : ${escapeHtml(sourceConfig.label)}<br>` +
        `${Number.isFinite(item.distanceKm) ? `Distance : ${escapeHtml(formatDistance(item.distanceKm))}<br>` : ""}` +
        websiteLink +
        onisepLink
    );

    marker.addTo(mapLayerGroup);
  });

  if (!points.length) {
    map.setView([46.603354, 1.888334], 6);
    return;
  }

  const bounds = window.L.latLngBounds(points);
  map.fitBounds(bounds, { padding: [24, 24] });
}

async function fetchDatasetRecords(datasetKey) {
  if (datasetCache.has(datasetKey)) {
    return datasetCache.get(datasetKey);
  }

  const config = DATASET_CONFIG[datasetKey];
  if (!config) {
    return [];
  }

  let offset = 0;
  let totalCount = Infinity;
  const allResults = [];

  while (offset < totalCount) {
    const url = `${config.endpoint}?limit=${DATASET_PAGE_SIZE}&offset=${offset}`;
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

  const normalized = allResults
    .filter((item) => item.position?.lat && item.position?.lon)
    .map((item) => normalizeInstitution(item, datasetKey, config.sportsField));

  datasetCache.set(datasetKey, normalized);
  return normalized;
}

async function fetchInstitutionsBySelection(selection) {
  if (selection === "all") {
    const [sportEtudes, sectionsSportives] = await Promise.all([
      fetchDatasetRecords("sport_etudes"),
      fetchDatasetRecords("sections_sportives"),
    ]);
    return [...sportEtudes, ...sectionsSportives];
  }

  return fetchDatasetRecords(selection);
}

function normalizeInstitution(raw, datasetKey, sportsField) {
  const sports = Array.isArray(raw[sportsField]) ? raw[sportsField] : [];
  return {
    ...raw,
    datasetKey,
    sports,
  };
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
    const sportsChips = renderSportsChips(item.sports);
    const sourceConfig = DATASET_CONFIG[item.datasetKey] || DATASET_CONFIG.sport_etudes;
    const distanceLine = Number.isFinite(item.distanceKm)
      ? `<p class="meta"><strong>Distance :</strong> ${formatDistance(item.distanceKm)}</p>`
      : "";

    li.innerHTML = `
      <h2>${escapeHtml(item.nom_etablissement || "Établissement inconnu")}</h2>
      <p class="meta inline-row"><strong>Source :</strong> <span class="badge ${sourceConfig.sourceClass}">${escapeHtml(
      sourceConfig.label
    )}</span></p>
      ${distanceLine}
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

initializeDefaultView();

async function initializeDefaultView() {
  setLoading(true);
  clearResults();
  latestUserPosition = null;
  try {
    await loadInstitutionsForCurrentMode(null);
  } catch (error) {
    setStatus(error.message || "Une erreur est survenue.");
  } finally {
    setLoading(false);
  }
}
