/* global L */

const DATA_URL = "./Maps/LakesOfSwitzerland_WGS84.geojson";
const COUNTRY_URL = "./Maps/Switzerland_WGS84.geojson";
const MANIFEST_URL = "./data/processed/build_manifest.json";
const SWITZERLAND_VIEW = [46.82, 8.23];
const SWITZERLAND_ZOOM = 8;
const SEERHEIN_LATLNGS = [
  [47.656265, 9.204826],
  [47.658548, 9.193944],
  [47.666184, 9.178762],
  [47.667647, 9.175498],
  [47.668747, 9.172821],
  [47.669343, 9.171114],
  [47.669698, 9.169681],
  [47.669976, 9.167769],
  [47.670205, 9.165962],
  [47.670314, 9.164239],
  [47.670392, 9.162991],
  [47.670396, 9.161934],
  [47.670248, 9.160678],
  [47.670034, 9.159896],
  [47.669666, 9.159021],
  [47.66906, 9.158155],
  [47.668303, 9.157039],
  [47.667867, 9.155913],
];

function riverOpacityForZoom(zoom) {
  if (zoom <= 7) return 0.18;
  if (zoom === 8) return 0.24;
  if (zoom === 9) return 0.3;
  if (zoom === 10) return 0.42;
  if (zoom === 11) return 0.54;
  return 0.68;
}

function seerheinWeightForZoom(zoom) {
  if (zoom <= 9) return 2.25;
  if (zoom <= 11) return 3;
  return 4;
}

const numberFormat = new Intl.NumberFormat("en-CH");
const normalStyle = {
  color: "#61b9d8",
  fillColor: "#247BA0",
  fillOpacity: 1,
  opacity: 0.96,
  weight: 1,
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
map.attributionControl.addAttribution("&copy; swisstopo");
L.control.zoom({ position: "bottomright" }).addTo(map);
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);

const terrainPane = map.createPane("terrain");
terrainPane.style.zIndex = "325";
terrainPane.style.pointerEvents = "none";
const terrainLayer = L.tileLayer(
  "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissalti3d-reliefschattierung/default/current/3857/{z}/{x}/{y}.png",
  {
    attribution: "&copy; swisstopo",
    maxZoom: 19,
    opacity: 0.34,
    pane: "terrain",
    tileSize: 256,
  },
).addTo(map);

const riversPane = map.createPane("rivers");
riversPane.style.zIndex = "350";
riversPane.style.pointerEvents = "none";
const riversLayer = L.tileLayer(
  "https://wmts.geo.admin.ch/1.0.0/ch.bafu.flussordnungszahlen-strahler/default/current/3857/{z}/{x}/{y}.png",
  {
    attribution: "&copy; BAFU",
    maxZoom: 19,
    minZoom: 7,
    opacity: riverOpacityForZoom(SWITZERLAND_ZOOM),
    pane: "rivers",
    tileSize: 256,
  },
).addTo(map);

const countryPane = map.createPane("country");
countryPane.style.zIndex = "300";
countryPane.style.pointerEvents = "none";
const countryRenderer = L.svg({ pane: "country", padding: 0.2 });

const countryMaskPane = map.createPane("countryMask");
countryMaskPane.style.zIndex = "375";
countryMaskPane.style.pointerEvents = "none";
const countryMaskRenderer = L.svg({ pane: "countryMask", padding: 0 });

const riverExceptionPane = map.createPane("riverExceptions");
riverExceptionPane.style.zIndex = "385";
riverExceptionPane.style.pointerEvents = "none";
const riverExceptionRenderer = L.svg({ pane: "riverExceptions", padding: 0.1 });
const seerheinLayer = L.polyline(SEERHEIN_LATLNGS, {
  color: "#0d465c",
  interactive: false,
  lineCap: "round",
  lineJoin: "round",
  opacity: Math.max(0.55, riverOpacityForZoom(SWITZERLAND_ZOOM)),
  pane: "riverExceptions",
  renderer: riverExceptionRenderer,
  smoothFactor: 0,
  weight: seerheinWeightForZoom(SWITZERLAND_ZOOM),
}).addTo(map);

const renderer = L.canvas({ padding: 0.4 });
map.createPane("exactSelection");
map.getPane("exactSelection").style.zIndex = "450";
map.getPane("exactSelection").style.pointerEvents = "none";
const exactRenderer = L.canvas({ pane: "exactSelection", padding: 0.7 });
const searchInput = document.querySelector("#lake-search");
const searchResults = document.querySelector("#search-results");
const featurePanel = document.querySelector("#feature-panel");
const fitButton = document.querySelector("#fit-button");
const terrainButton = document.querySelector("#terrain-button");
const riversButton = document.querySelector("#rivers-button");
const terrainLegend = document.querySelector("#terrain-legend");
const riverLegend = document.querySelector("#river-legend");
const zoomLabel = document.querySelector("#zoom-label");
const loadPanel = document.querySelector("#load-panel");
const loadTitle = document.querySelector("#load-title");
const loadStatus = document.querySelector("#load-status");
const progressBar = document.querySelector("#progress-bar");

let lakesLayer;
let exactSelection;
let selectedLayer;
let searchIndex = [];
let visibleStatsReady = false;

function featureStyle() {
  return normalStyle;
}

function isDisplayedLake(feature) {
  const properties = feature.properties ?? {};
  return Boolean(properties.border_lake || properties.country?.includes("CH"));
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

function updateVisibleStats(features) {
  const namedFeatures = features.filter((feature) => feature.properties?.name).length;
  const interiorRings = features.reduce(
    (total, feature) => total + countGeometry(feature.geometry).rings,
    0,
  );
  document.querySelector("#feature-count").textContent = numberFormat.format(features.length);
  document.querySelector("#named-count").textContent = numberFormat.format(namedFeatures);
  document.querySelector("#ring-count").textContent = numberFormat.format(interiorRings);
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
    if (visibleStatsReady) return;
    document.querySelector("#feature-count").textContent = numberFormat.format(manifest.features);
    document.querySelector("#named-count").textContent = numberFormat.format(manifest.named_features);
    document.querySelector("#ring-count").textContent = numberFormat.format(manifest.interior_rings);
  } catch {
    // Static fallback values in the HTML remain visible.
  }
}

async function loadCountryBoundary() {
  try {
    const response = await fetch(COUNTRY_URL);
    if (!response.ok) return;
    const country = await response.json();
    L.geoJSON(country, {
      interactive: false,
      pane: "country",
      renderer: countryRenderer,
      smoothFactor: 0,
      style: {
        color: "#3a4144",
        fillColor: "#20272a",
        fillOpacity: 1,
        opacity: 0.72,
        weight: 0.85,
      },
    }).addTo(map);
    addCountryMask(country.features[0]?.geometry);
  } catch {
    // The lake map remains usable if the visual country backdrop is unavailable.
  }
}

function addCountryMask(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return;

  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const worldRing = [[85, -180], [85, 180], [-85, 180], [-85, -180], [85, -180]];
  const toLatLngRing = (ring) => ring.map(([longitude, latitude]) => [latitude, longitude]);
  const outerRings = polygons.map((polygon) => toLatLngRing(polygon[0]));

  L.polygon([worldRing, ...outerRings], {
    fill: true,
    fillColor: "#0f0f0f",
    fillOpacity: 1,
    fillRule: "evenodd",
    interactive: false,
    pane: "countryMask",
    renderer: countryMaskRenderer,
    smoothFactor: 0,
    stroke: false,
  }).addTo(map);

  for (const polygon of polygons) {
    for (const hole of polygon.slice(1)) {
      L.polygon(toLatLngRing(hole), {
        fillColor: "#0f0f0f",
        fillOpacity: 1,
        interactive: false,
        pane: "countryMask",
        renderer: countryMaskRenderer,
        smoothFactor: 0,
        stroke: false,
      }).addTo(map);
    }
  }
}

async function initialize() {
  loadCountryBoundary();
  loadManifest();

  try {
    const geoJson = await fetchGeoJsonWithProgress(DATA_URL);
    const visibleFeatures = geoJson.features.filter(isDisplayedLake);
    const visibleGeoJson = { ...geoJson, features: visibleFeatures };
    loadTitle.textContent = "Drawing map";
    loadStatus.textContent = `${numberFormat.format(visibleFeatures.length)} features...`;
    progressBar.style.width = "97%";
    await new Promise((resolve) => requestAnimationFrame(resolve));

    lakesLayer = L.geoJSON(visibleGeoJson, {
      onEachFeature,
      renderer,
      smoothFactor: 1,
      style: featureStyle,
    }).addTo(map);

    progressBar.style.width = "100%";
    loadTitle.textContent = "Map ready";
    loadStatus.textContent = `${numberFormat.format(visibleFeatures.length)} lakes loaded`;
    visibleStatsReady = true;
    updateVisibleStats(visibleFeatures);
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

terrainButton.addEventListener("click", () => {
  const shouldShow = !map.hasLayer(terrainLayer);
  if (shouldShow) terrainLayer.addTo(map);
  else map.removeLayer(terrainLayer);
  terrainButton.classList.toggle("is-active", shouldShow);
  terrainButton.setAttribute("aria-pressed", String(shouldShow));
  terrainLegend.hidden = !shouldShow;
});

riversButton.addEventListener("click", () => {
  const shouldShow = !map.hasLayer(riversLayer);
  if (shouldShow) {
    riversLayer.addTo(map);
    seerheinLayer.addTo(map);
  } else {
    map.removeLayer(riversLayer);
    map.removeLayer(seerheinLayer);
  }
  riversButton.classList.toggle("is-active", shouldShow);
  riversButton.setAttribute("aria-pressed", String(shouldShow));
  riverLegend.hidden = !shouldShow;
});

map.on("zoomend", () => {
  const zoom = map.getZoom();
  zoomLabel.textContent = `Zoom ${zoom}`;
  riversLayer.setOpacity(riverOpacityForZoom(zoom));
  seerheinLayer.setStyle({
    opacity: Math.max(0.55, riverOpacityForZoom(zoom)),
    weight: seerheinWeightForZoom(zoom),
  });
});

initialize();
