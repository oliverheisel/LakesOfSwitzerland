import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_pages_entrypoint_references_versioned_assets() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert '<html lang="en">' in html
    assert "./styles.css" in html
    assert "./app.js" in html
    assert "./assets/favicon.svg" in html
    assert "./assets/logo/oliver-heisel-wordmark.png" in html
    assert 'class="brand-logo-primary"' in html
    assert "leaflet@1.9.4" in html
    assert (ROOT / "assets" / "favicon.svg").is_file()
    assert (ROOT / "assets" / "logo" / "oliver-heisel-wordmark.png").is_file()

    javascript = (ROOT / "app.js").read_text(encoding="utf-8")
    stylesheet = (ROOT / "styles.css").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert './Maps/LakesOfSwitzerland_WGS84.geojson' in javascript
    assert './Maps/Switzerland_WGS84.geojson' in javascript
    assert './data/processed/build_manifest.json' in javascript
    assert "ch.bafu.flussordnungszahlen-strahler" in javascript
    assert "ch.swisstopo.pixelkarte-grau" not in javascript
    assert "smoothFactor: 0" in javascript
    assert 'map.createPane("exactSelection")' in javascript
    assert 'style.pointerEvents = "none"' in javascript
    assert 'map.createPane("rivers")' in javascript
    assert 'riversPane.style.pointerEvents = "none"' in javascript
    assert 'countryPane.style.pointerEvents = "none"' in javascript
    assert 'map.createPane("countryMask")' in javascript
    assert 'countryMaskPane.style.pointerEvents = "none"' in javascript
    assert 'const countryRenderer = L.svg' in javascript
    assert 'fillRule: "evenodd"' in javascript
    assert "function isDisplayedLake(feature)" in javascript
    assert "geoJson.features.filter(isDisplayedLake)" in javascript
    assert 'color: "#3a4144"' in javascript
    assert javascript.count("fillOpacity: 1") >= 3
    assert 'id="rivers-button"' in html
    assert 'aria-pressed="true"' in html
    assert 'riversButton.addEventListener("click"' in javascript
    assert "map.attributionControl.setPrefix(false)" in javascript
    assert "function formatLakeName(value)" in javascript
    assert "/see$/iu" in javascript
    assert 'class="alternate-names"' in javascript
    assert "--brand-primary: #f5ff00" in stylesheet
    assert "\u2014" not in html + javascript + readme
    assert "\u2013" not in html + javascript + readme
    assert "17’966" in html
    assert "1’486" in html


def test_pages_workflow_stages_only_required_site_files() -> None:
    workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(
        encoding="utf-8"
    )
    assert "actions/configure-pages@v6" in workflow
    assert "actions/upload-pages-artifact@v5" in workflow
    assert "actions/deploy-pages@v5" in workflow
    assert "cp -R assets _site/" in workflow
    assert "cp Maps/LakesOfSwitzerland_WGS84.geojson _site/Maps/" in workflow
    assert "cp Maps/Switzerland_WGS84.geojson _site/Maps/" in workflow
    assert "path: _site" in workflow


def test_country_backdrop_is_an_unsimplified_vector_polygon() -> None:
    boundary_path = ROOT / "Maps" / "Switzerland_WGS84.geojson"
    boundary = json.loads(boundary_path.read_text(encoding="utf-8"))
    assert len(boundary["features"]) == 1
    feature = boundary["features"][0]
    assert feature["properties"]["country"] == "CH"
    assert feature["geometry"]["type"] == "Polygon"
