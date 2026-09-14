from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_pages_entrypoint_references_versioned_assets() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert "./styles.css" in html
    assert "./app.js" in html
    assert "leaflet@1.9.4" in html

    javascript = (ROOT / "app.js").read_text(encoding="utf-8")
    assert './Maps/LakesOfSwitzerland_WGS84.geojson' in javascript
    assert './data/processed/build_manifest.json' in javascript
    assert "smoothFactor: 0" in javascript


def test_pages_workflow_stages_only_required_site_files() -> None:
    workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(
        encoding="utf-8"
    )
    assert "actions/configure-pages@v6" in workflow
    assert "actions/upload-pages-artifact@v5" in workflow
    assert "actions/deploy-pages@v5" in workflow
    assert "cp Maps/LakesOfSwitzerland_WGS84.geojson _site/Maps/" in workflow
    assert "path: _site" in workflow
