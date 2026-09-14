/* global L */

const DATA_URL = "./Maps/LakesOfSwitzerland_WGS84.geojson";
const MANIFEST_URL = "./data/processed/build_manifest.json";
const SWITZERLAND_VIEW = [46.82, 8.23];
const SWITZERLAND_ZOOM = 8;

const numberFormat = new Intl.NumberFormat("en-CH");
const normalStyle = {
  color: "#61b9d8",
  fillColor: "#247BA0",
  fillOpacity: 0.76,
  opacity: 0.96,
  weight: 1,
};
const borderStyle = {
  color: "#a6e1f3",
  fillColor: "#3f9fc4",
  fillOpacity: 0.82,
  opacity: 1,
  weight: 1.8,
};

const map = L.map("map", {
  center: SWITZERLAND_VIEW,
  zoom: SWITZERLAND_ZOOM,
  minZoom: 6,
  maxZoom: 19,
  preferCanvas: true,
  zoomControl: false,
});

map.attributionControl.setPrefix(false);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);

L.tileLayer(
  "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissalti3d-reliefschattierung/default/current/3857/{z}/{x}/{y}.png",
  {
    attribution: "&copy; swisstopo",
    maxZoom: 19,
    tileSize: 256,
  },
).addTo(map);

const riversPane = map.createPane("rivers");
riversPane.style.zIndex = "350";
riversPane.style.pointerEvents = "none";
const riversLayer = L.tileLayer(
  "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swisstlm3d-gewaessernetz/default/current/3857/{z}/{x}/{y}.png",
  {
    attribution: "&copy; swisstopo",
    maxZoom: 19,
    minZoom: 8,
    opacity: 0.1,
    pane: "rivers",
    tileSize: 256,
  },
).addTo(map);

const renderer = L.canvas({ padding: 0.4 });
map.createPane("exactSelection");
map.getPane("exactSelection").style.zIndex = "450";
map.getPane("exactSelection").style.pointerEvents = "none";
const exactRenderer = L.canvas({ pane: "exactSelection", padding: 0.7 });
const searchInput = document.querySelector("#lake-search");
const searchResults = document.querySelector("#search-results");
const featurePanel = document.querySelector("#feature-panel");
const fitButton = document.querySelector("#fit-button");
const zoomLabel = document.querySelector("#zoom-label");
const loadPanel = document.querySelector("#load-panel");
const loadTitle = document.querySelector("#load-title");
const loadStatus = document.querySelector("#load-status");
const progressBar = document.querySelector("#progress-bar");

let lakesLayer;
let exactSelection;
let selectedLayer;
let searchIndex = [];

function featureStyle(feature) {
  return feature.properties?.border_lake ? borderStyle : normalStyle;
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CH");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function countGeometry(geometry) {
  let vertices = 0;
  let rings = 0;
  let polygons = 0;

  const countPolygon = (polygon) => {
    polygons += 1;
    rings += Math.max(0, polygon.length - 1);
    for (const ring of polygon) vertices += ring.length;
  };

  if (geometry.type === "Polygon") countPolygon(geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) countPolygon(polygon);
  }

  return { vertices, rings, polygons };
}

function countryNames(countries) {
  const names = { CH: "Switzerland", DE: "Germany", AT: "Austria", FR: "France", IT: "Italy" };
  return (countries ?? []).map((code) => names[code] ?? code).join(", ") || "N/A";
}

function propertyRow(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function formatLakeName(value) {
  const names = String(value || "Unnamed lake")
    .split(/\s+(?:\||\/)\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
  const germanIndex = names.findIndex((name) => /see$/iu.test(name));
  const primaryIndex = germanIndex >= 0 ? germanIndex : 0;

  return {
    primary: names[primaryIndex],
    alternatives: names.filter((_, index) => index !== primaryIndex),
  };
}

function renderFeaturePanel(feature) {
  const properties = feature.properties ?? {};
  const details = countGeometry(feature.geometry);
  const name = formatLakeName(properties.name);
  const geometryLabel = details.polygons > 1
    ? `MultiPolygon, ${numberFormat.format(details.polygons)} parts`
    : "Polygon";
  const alternatives = name.alternatives.length
    ? `<p class="alternate-names">${name.alternatives.map(escapeHtml).join("<br>")}</p>`
    : "";

  featurePanel.innerHTML = `
    <p class="panel-kicker">Selected lake</p>
    <h2>${escapeHtml(name.primary)}</h2>
    ${alternatives}
    <dl class="detail-list">
      ${propertyRow("Vertices", numberFormat.format(details.vertices))}
      ${propertyRow("Geometry", geometryLabel)}
      ${propertyRow("Holes", numberFormat.format(details.rings))}
      ${propertyRow("Countries", countryNames(properties.country))}
      ${propertyRow("Lake ID", properties.lake_id || "N/A")}
    </dl>
  `;
}

function selectFeature(layer, shouldZoom = false) {
  if (selectedLayer) lakesLayer.resetStyle(selectedLayer);
  if (exactSelection) map.removeLayer(exactSelection);

  selectedLayer = layer;
  selectedLayer.setStyle({ color: "#ffffff", opacity: 1, weight: 2.2 });
  exactSelection = L.geoJSON(layer.feature, {
    interactive: false,
    pane: "exactSelection",
    renderer: exactRenderer,
    smoothFactor: 0,
    style: {
      color: "#ffffff",
      fill: false,
      opacity: 1,
      weight: 2.8,
    },
  }).addTo(map);

  renderFeaturePanel(layer.feature);
  if (shouldZoom) map.fitBounds(layer.getBounds(), { maxZoom: 16, padding: [40, 40] });
}

function addToSearchIndex(feature, layer) {
  const properties = feature.properties ?? {};
  const rawName = properties.name;
  const id = properties.lake_id || properties.gewiss_nr || properties.source_feature_id;
  if (!rawName && !id) return;

  const name = formatLakeName(rawName || `Lake ${id}`);
  const label = name.primary;
  const descriptor = name.alternatives.join(", ") || (properties.border_lake
    ? countryNames(properties.country)
    : (properties.gewiss_nr ? `GEWISS ${properties.gewiss_nr}` : properties.lake_id));

  searchIndex.push({
    descriptor: descriptor || "Unnamed",
    label,
    layer,
    normalized: normalize(`${rawName || label} ${id} ${properties.gewiss_nr ?? ""}`),
  });
}

function onEachFeature(feature, layer) {
  const name = feature.properties?.name;
  if (name) {
    layer.bindTooltip(formatLakeName(name).primary, {
      className: "lake-tooltip",
      direction: "top",
      sticky: true,
    });
  }
  layer.on("click", () => selectFeature(layer));
  addToSearchIndex(feature, layer);
}

function closeSearchResults() {
  searchResults.hidden = true;
  searchResults.replaceChildren();
  searchInput.setAttribute("aria-expanded", "false");
}

function renderSearchResults() {
  const query = normalize(searchInput.value.trim());
  if (!query) {
    closeSearchResults();
    return;
  }

  const matches = searchIndex
    .filter((item) => item.normalized.includes(query))
    .sort((a, b) => {
      const aStarts = normalize(a.label).startsWith(query) ? 0 : 1;
      const bStarts = normalize(b.label).startsWith(query) ? 0 : 1;
      return aStarts - bStarts || a.label.localeCompare(b.label, "en-CH");
    })
    .slice(0, 8);

  searchResults.replaceChildren();
  if (!matches.length) {
    const item = document.createElement("li");
    item.innerHTML = "<button type=\"button\" disabled>No results</button>";
    searchResults.append(item);
  } else {
    for (const match of matches) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<strong>${escapeHtml(match.label)}</strong><small>${escapeHtml(match.descriptor)}</small>`;
      button.addEventListener("click", () => {
        searchInput.value = match.label;
        closeSearchResults();
        selectFeature(match.layer, true);
      });
      item.append(button);
      searchResults.append(item);
    }
  }

  searchResults.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
}

async function fetchGeoJsonWithProgress(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const total = Number(response.headers.get("content-length"));
  if (!response.body?.getReader) return response.json();

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total) {
      const percent = Math.min(92, Math.round((loaded / total) * 92));
      progressBar.style.width = `${percent}%`;
      loadStatus.textContent = `${(loaded / 1_000_000).toFixed(1)} of ${(total / 1_000_000).toFixed(1)} MB`;
    } else {
      loadStatus.textContent = `${(loaded / 1_000_000).toFixed(1)} MB downloaded`;
    }
  }

  loadStatus.textContent = "Parsing GeoJSON...";
  progressBar.style.width = "95%";
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return JSON.parse(await new Blob(chunks).text());
}

async function loadManifest() {
  try {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) return;
    const manifest = await response.json();
    document.querySelector("#feature-count").textContent = numberFormat.format(manifest.features);
    document.querySelector("#named-count").textContent = numberFormat.format(manifest.named_features);
    document.querySelector("#ring-count").textContent = numberFormat.format(manifest.interior_rings);
  } catch {
    // Static fallback values in the HTML remain visible.
  }
}

async function initialize() {
  loadManifest();

  try {
    const geoJson = await fetchGeoJsonWithProgress(DATA_URL);
    loadTitle.textContent = "Drawing map";
    loadStatus.textContent = `${numberFormat.format(geoJson.features.length)} features...`;
    progressBar.style.width = "97%";
    await new Promise((resolve) => requestAnimationFrame(resolve));

    lakesLayer = L.geoJSON(geoJson, {
      onEachFeature,
      renderer,
      smoothFactor: 1,
      style: featureStyle,
    }).addTo(map);

    progressBar.style.width = "100%";
    loadTitle.textContent = "Map ready";
    loadStatus.textContent = `${numberFormat.format(geoJson.features.length)} lakes loaded`;
    searchIndex.sort((a, b) => a.label.localeCompare(b.label, "en-CH"));
    searchInput.disabled = false;
    fitButton.disabled = false;
    window.setTimeout(() => loadPanel.classList.add("is-hidden"), 700);
  } catch (error) {
    loadPanel.classList.add("is-error");
    loadTitle.textContent = "Map could not load";
    loadStatus.textContent = `${error.message}. Please reload the page.`;
    progressBar.style.width = "100%";
  }
}

searchInput.addEventListener("input", renderSearchResults);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSearchResults();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-section")) closeSearchResults();
});

fitButton.addEventListener("click", () => {
  if (!lakesLayer) return;
  map.fitBounds(lakesLayer.getBounds(), { padding: [24, 24] });
});

map.on("zoomend", () => {
  const zoom = map.getZoom();
  zoomLabel.textContent = `Zoom ${zoom}`;
  riversLayer.setOpacity(zoom <= 8 ? 0.1 : zoom <= 10 ? 0.17 : 0.25);
});

initialize();
