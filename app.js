/* global L */

const DATA_URL = "./Maps/LakesOfSwitzerland_WGS84.geojson";
const MANIFEST_URL = "./data/processed/build_manifest.json";
const SWITZERLAND_VIEW = [46.82, 8.23];
const SWITZERLAND_ZOOM = 8;

const numberFormat = new Intl.NumberFormat("de-CH");
const normalStyle = {
  color: "#076b8a",
  fillColor: "#25b4d8",
  fillOpacity: 0.57,
  opacity: 0.8,
  weight: 0.8,
};
const borderStyle = {
  color: "#9c4b17",
  fillColor: "#f1843e",
  fillOpacity: 0.67,
  opacity: 0.95,
  weight: 1.5,
};

const map = L.map("map", {
  center: SWITZERLAND_VIEW,
  zoom: SWITZERLAND_ZOOM,
  minZoom: 6,
  maxZoom: 19,
  preferCanvas: true,
  zoomControl: false,
});

L.control.zoom({ position: "bottomright" }).addTo(map);
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);

L.tileLayer(
  "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg",
  {
    attribution: "Basiskarte: &copy; swisstopo",
    maxZoom: 19,
    tileSize: 256,
  },
).addTo(map);

const renderer = L.canvas({ padding: 0.4 });
const exactRenderer = L.canvas({ padding: 0.7, tolerance: 5 });
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
    .toLocaleLowerCase("de-CH");
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
  const names = { CH: "Schweiz", DE: "Deutschland", AT: "Österreich", FR: "Frankreich", IT: "Italien" };
  return (countries ?? []).map((code) => names[code] ?? code).join(" · ") || "–";
}

function propertyRow(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderFeaturePanel(feature) {
  const properties = feature.properties ?? {};
  const details = countGeometry(feature.geometry);
  const name = properties.name || "Unbenanntes Gewässer";
  const geometryLabel = details.polygons > 1
    ? `MultiPolygon · ${numberFormat.format(details.polygons)} Teile`
    : "Polygon";

  featurePanel.innerHTML = `
    <p class="panel-kicker">Ausgewähltes Gewässer</p>
    <h2>${escapeHtml(name)}</h2>
    <p>Die orange-rote Uferlinie wird mit sämtlichen Punkten der Quelldatei dargestellt.</p>
    <dl class="detail-list">
      ${propertyRow("Stützpunkte", numberFormat.format(details.vertices))}
      ${propertyRow("Geometrie", geometryLabel)}
      ${propertyRow("Innenringe", numberFormat.format(details.rings))}
      ${propertyRow("Länder", countryNames(properties.country))}
      ${propertyRow("Lake ID", properties.lake_id || "–")}
      ${propertyRow("GEWISS-Nr.", properties.gewiss_nr || "–")}
      ${propertyRow("Quelljahr", properties.source_year || "–")}
    </dl>
    <p class="panel-hint">Zoomen zeigt die Ufergeometrie bis auf den einzelnen Stützpunkt genau.</p>
  `;
}

function selectFeature(layer, shouldZoom = false) {
  if (selectedLayer) lakesLayer.resetStyle(selectedLayer);
  if (exactSelection) map.removeLayer(exactSelection);

  selectedLayer = layer;
  selectedLayer.setStyle({ color: "#ff4d20", opacity: 1, weight: 2.2 });
  exactSelection = L.geoJSON(layer.feature, {
    interactive: false,
    renderer: exactRenderer,
    smoothFactor: 0,
    style: {
      color: "#ff4d20",
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
  const name = properties.name;
  const id = properties.lake_id || properties.gewiss_nr || properties.source_feature_id;
  if (!name && !id) return;

  const label = name || `Gewässer ${id}`;
  const descriptor = properties.border_lake
    ? countryNames(properties.country)
    : (properties.gewiss_nr ? `GEWISS ${properties.gewiss_nr}` : properties.lake_id);

  searchIndex.push({
    descriptor: descriptor || "Unbenannt",
    label,
    layer,
    normalized: normalize(`${label} ${id} ${properties.gewiss_nr ?? ""}`),
  });
}

function onEachFeature(feature, layer) {
  const name = feature.properties?.name;
  if (name) layer.bindTooltip(name, { className: "lake-tooltip", direction: "top", sticky: true });
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
      return aStarts - bStarts || a.label.localeCompare(b.label, "de-CH");
    })
    .slice(0, 8);

  searchResults.replaceChildren();
  if (!matches.length) {
    const item = document.createElement("li");
    item.innerHTML = "<button type=\"button\" disabled>Kein Treffer</button>";
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
      loadStatus.textContent = `${(loaded / 1_000_000).toFixed(1)} von ${(total / 1_000_000).toFixed(1)} MB`;
    } else {
      loadStatus.textContent = `${(loaded / 1_000_000).toFixed(1)} MB übertragen`;
    }
  }

  loadStatus.textContent = "GeoJSON wird ausgewertet …";
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
    loadTitle.textContent = "Karte wird gezeichnet";
    loadStatus.textContent = `${numberFormat.format(geoJson.features.length)} Geometrien …`;
    progressBar.style.width = "97%";
    await new Promise((resolve) => requestAnimationFrame(resolve));

    lakesLayer = L.geoJSON(geoJson, {
      onEachFeature,
      renderer,
      smoothFactor: 1,
      style: featureStyle,
    }).addTo(map);

    progressBar.style.width = "100%";
    loadTitle.textContent = "Karte bereit";
    loadStatus.textContent = `${numberFormat.format(geoJson.features.length)} Gewässer geladen`;
    searchIndex.sort((a, b) => a.label.localeCompare(b.label, "de-CH"));
    searchInput.disabled = false;
    fitButton.disabled = false;
    window.setTimeout(() => loadPanel.classList.add("is-hidden"), 700);
  } catch (error) {
    loadPanel.classList.add("is-error");
    loadTitle.textContent = "Karte konnte nicht geladen werden";
    loadStatus.textContent = `${error.message}. Bitte Seite neu laden.`;
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
  zoomLabel.textContent = `Zoom ${map.getZoom()}`;
});

initialize();
