from __future__ import annotations

import hashlib
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
from pyproj import CRS
import shapely


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "Maps" / "LakesOfSwitzerland_WGS84.geojson"
MANIFEST = ROOT / "data" / "processed" / "build_manifest.json"

EXPECTED_COUNTRIES = {
    "lake_constance": ["CH", "DE", "AT"],
    "lake_geneva": ["CH", "FR"],
    "lake_maggiore": ["CH", "IT"],
    "lake_lugano": ["CH", "IT"],
}


def _horizontal_epsg(crs_like: object) -> int | None:
    crs = CRS.from_user_input(crs_like)
    if crs.is_compound and crs.sub_crs_list:
        crs = crs.sub_crs_list[0]
    return crs.to_epsg()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _border_properties() -> dict[str, dict[str, object]]:
    """Read only four feature lines; GDAL cannot read GeoJSON list fields back."""
    result: dict[str, dict[str, object]] = {}
    with OUTPUT.open(encoding="utf-8") as stream:
        for line in stream:
            if not any(f'"lake_id": "{lake_id}"' in line for lake_id in EXPECTED_COUNTRIES):
                continue
            feature = json.loads(line.strip().removesuffix(","))
            properties = feature["properties"]
            result[str(properties["lake_id"])] = properties
    return result


def test_final_geojson_exists_and_loads() -> None:
    assert OUTPUT.is_file()
    dataset = gpd.read_file(OUTPUT, engine="pyogrio")
    assert not dataset.empty
    assert _horizontal_epsg(dataset.crs) == 4326


def test_geometry_quality_and_ids() -> None:
    dataset = gpd.read_file(OUTPUT, engine="pyogrio")
    assert not dataset.geometry.isna().any()
    assert not dataset.geometry.is_empty.any()
    assert dataset.geometry.is_valid.all()
    assert not dataset.geometry.has_z.any()
    assert set(dataset.geom_type) <= {"Polygon", "MultiPolygon"}
    assert dataset["lake_id"].is_unique
    assert dataset["lake_id"].tolist() == sorted(dataset["lake_id"].tolist())


def test_no_duplicate_or_overlapping_geometries() -> None:
    dataset = gpd.read_file(OUTPUT, engine="pyogrio")
    normalised = dataset.geometry.normalize().to_wkb(hex=True)
    assert not pd.Series(normalised).duplicated().any()
    pairs = dataset.sindex.query(dataset.geometry, predicate="overlaps")
    assert int((pairs[0] < pairs[1]).sum()) == 0
    parts = shapely.get_parts(dataset.geometry.array)
    assert int(shapely.get_num_interior_rings(parts).sum()) > 0


def test_border_lakes_and_country_arrays() -> None:
    properties = _border_properties()
    assert set(properties) == set(EXPECTED_COUNTRIES)
    for lake_id, countries in EXPECTED_COUNTRIES.items():
        assert properties[lake_id]["country"] == countries
        assert properties[lake_id]["border_lake"] is True
    dataset = gpd.read_file(OUTPUT, engine="pyogrio")
    constance = dataset.loc[dataset["lake_id"].eq("lake_constance"), "geometry"].iloc[0]
    assert constance.geom_type == "MultiPolygon"
    assert shapely.get_num_geometries(constance) >= 2


def test_build_manifest_makes_output_reproducibly_verifiable() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert manifest["build"] == "python3 tools/build_lakes.py"
    assert manifest["release"] == "swissTLM3D 2.4 (2026-02)"
    assert manifest["source_release_asset_sha256"] == (
        "2218054b21c23e1683fb14a80a9c33d811c7e02a891ab4aedaf761b68750206a"
    )
    assert manifest["features"] > 0
    assert manifest["invalid_geometries"] == 0
    assert manifest["interior_rings"] > 0
    assert manifest["overlapping_feature_pairs"] == 0
    assert manifest["output_sha256"] == _sha256(OUTPUT)
