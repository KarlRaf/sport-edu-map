const DATASET_BASE_URL =
  "https://dataeducation.opendatasoft.com/api/explore/v2.1/catalog/datasets/fr-en-sport-etudes/records";
const DATASET_PAGE_SIZE = 100;
const OSM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const RESULT_COUNT = 10;
const AUTOCOMPLETE_LIMIT = 5;
const AUTOCOMPLETE_MIN_CHARS = 3;
const AUTOCOMPLETE_DEBOUNCE_MS = 350;

const form = document.getElementById("search-form");
const addressInput = document.getElementById("address");
const suggestionsList = document.getElementById("address-suggestions");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

let selectedPlace = null;
let latestSuggestionRequest = 0;
let inputDebounceTimer = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
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
    clearSuggestions();
    return;
  }

  inputDebounceTimer = setTimeout(() => {
    fetchAddressSuggestions(query).catch(() => {
      clearSuggestions();
    });
  }, AUTOCOMPLETE_DEBOUNCE_MS);
});

addressInput.addEventListener("change", () => {
  const selectedLabel = addressInput.value.trim();
  if (!selectedLabel) {
    selectedPlace = null;
    return;
  }

  const option = suggestionsList.querySelector(`option[value="${cssEscape(selectedLabel)}"]`);
  if (!option) {
    selectedPlace = null;
    return;
  }

  selectedPlace = {
    lat: Number(option.dataset.lat),
    lon: Number(option.dataset.lon),
    label: option.dataset.label || selectedLabel,
  };
});

async function getUserPosition(address) {
  if (selectedPlace) {
    return selectedPlace;
  }
  return geocodeAddress(address);
}

async function fetchAddressSuggestions(query) {
  const requestId = ++latestSuggestionRequest;
  const places = await searchNominatim(query, AUTOCOMPLETE_LIMIT);

  if (requestId !== latestSuggestionRequest) {
    return;
  }

  renderSuggestions(places);
}

async function geocodeAddress(address) {
  const places = await searchNominatim(address, 1);
  const first = places[0];

  if (!first) {
    throw new Error("Adresse introuvable. Essayez une adresse plus précise en France.");
  }

  return first;
}

async function searchNominatim(query, limit) {
  const url = new URL(OSM_SEARCH_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "fr");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("q", query);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
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
  clearSuggestions();

  for (const place of places) {
    const option = document.createElement("option");
    option.value = place.label;
    option.dataset.label = place.label;
    option.dataset.lat = String(place.lat);
    option.dataset.lon = String(place.lon);
    suggestionsList.appendChild(option);
  }
}

function clearSuggestions() {
  suggestionsList.innerHTML = "";
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

    const sports = Array.isArray(item.pratique_proposee)
      ? item.pratique_proposee.join(", ")
      : "Non renseigné";

    li.innerHTML = `
      <h2>${escapeHtml(item.nom_etablissement || "Établissement inconnu")}</h2>
      <p class="meta"><strong>Distance :</strong> ${formatDistance(item.distanceKm)}</p>
      <p class="meta"><strong>Type :</strong> ${escapeHtml(item.type_etablissement || "-")}</p>
      <p class="meta"><strong>Localisation :</strong> ${escapeHtml(
        `${item.nom_commune || "-"}, ${item.libelle_departement || "-"}`
      )}</p>
      <p class="meta"><strong>Sports :</strong> ${escapeHtml(sports)}</p>
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/"/g, "\\\"");
}
