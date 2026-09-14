#!/usr/bin/env python3
"""Build the authoritative LakesOfSwitzerland WGS84 master dataset.

The preferred input is the extracted swissTLM3D 2.4 (2026) GeoPackage.  To
keep the one-command build practical, the script can alternatively fetch only
the required feature classes from swisstopo's official Shapefile distribution.
Both distributions contain the same release and geometries.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys
import zipfile

import geopandas as gpd
import pandas as pd
import pyogrio
from pyproj import CRS
import shapely
from shapely.geometry import MultiPolygon, Polygon


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "switzerland"
PROCESSED_DIR = ROOT / "data" / "processed"
DEFAULT_OUTPUT = ROOT / "Maps" / "LakesOfSwitzerland_WGS84.geojson"
MANIFEST_PATH = PROCESSED_DIR / "build_manifest.json"

RELEASE = "swissTLM3D 2.4 (2026-02)"
SOURCE_YEAR = 2026
SOURCE_LABEL = "Federal Office of Topography swisstopo; swissTLM3D 2.4 (2026)"
ARCHIVE_URL = (
    "https://data.geo.admin.ch/ch.swisstopo.swisstlm3d/"
    "swisstlm3d_2026-02/swisstlm3d_2026-02_2056_5728.shp.zip"
)
GPKG_ARCHIVE_SHA256 = "2218054b21c23e1683fb14a80a9c33d811c7e02a891ab4aedaf761b68750206a"
SHAPEFILE_ARCHIVE_SHA256 = "75086b5aa7e721f5ad2ea080e14e9e3f42d5e0afdee31c2e3c162f412fab4114"

SHAPEFILE_BASES = (
    "swissTLM3D_TLM_BODENBEDECKUNG_OST",
    "swissTLM3D_TLM_BODENBEDECKUNG_WEST",
    "swissTLM3D_TLM_STEHENDES_GEWAESSER",
)
SHAPEFILE_SUFFIXES = (".cpg", ".dbf", ".prj", ".shp", ".shx")

BORDER_LAKES = {
    "lake_constance": {
        "name": "Bodensee",
        "countries": ["CH", "DE", "AT"],
        "gewiss": {9326, 10014},
        "area_km2": (500.0, 570.0),
        "bounds": (8.85, 47.47, 9.75, 47.82),
    },
    "lake_geneva": {
        "name": "Genfersee / Lac Léman",
        "countries": ["CH", "FR"],
        "gewiss": {9757},
        "area_km2": (550.0, 620.0),
        "bounds": (6.14, 46.20, 6.93, 46.52),
    },
    "lake_maggiore": {
        "name": "Lago Maggiore / Langensee",
        "countries": ["CH", "IT"],
        "gewiss": {9711},
        "area_km2": (190.0, 230.0),
        "bounds": (8.47, 45.71, 8.88, 46.19),
    },
    "lake_lugano": {
        "name": "Luganersee / Lago di Lugano",
        "countries": ["CH", "IT"],
        "gewiss": {9710},
        "area_km2": (40.0, 60.0),
        "bounds": (8.85, 45.89, 9.13, 46.04),
    },
}


class BuildError(RuntimeError):
    """An actionable source-data or validation error."""


def _normalise_text(value: object) -> str:
    return (
        str(value)
        .strip()
        .lower()
        .replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
        .replace("_", " ")
    )


def _is_standing_water(value: object) -> bool:
    if pd.isna(value):
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return math.isclose(float(value), 10.0)
    normalised = " ".join(_normalise_text(value).split())
    return normalised in {"10", "stehende gewaesser", "stehendes gewaesser"}


def _horizontal_epsg(crs_like: object) -> int | None:
    crs = CRS.from_user_input(crs_like)
    if crs.is_compound and crs.sub_crs_list:
        crs = crs.sub_crs_list[0]
    return crs.to_epsg()


def _mode(values: pd.Series) -> object:
    cleaned = [str(value).strip() for value in values if pd.notna(value) and str(value).strip()]
    if not cleaned:
        return None
    counts = Counter(cleaned)
    return sorted(counts, key=lambda value: (-counts[value], value))[0]


def _join_distinct(values: pd.Series) -> str | None:
    cleaned = sorted({str(value).strip() for value in values if pd.notna(value) and str(value).strip()})
    return "|".join(cleaned) if cleaned else None


def _countries_from_linst(values: pd.Series) -> list[str]:
    authorities = {str(value).strip().upper() for value in values if pd.notna(value)}
    countries: list[str] = []
    if authorities - {"FL"}:
        countries.append("CH")
    if "FL" in authorities:
        countries.append("LI")
    return countries or ["CH"]


def _find_extracted_gpkg() -> Path | None:
    candidates = sorted(RAW_DIR.glob("*.gpkg"))
    return candidates[0] if candidates else None


def _extract_local_gpkg_zip() -> Path | None:
    archives = sorted(RAW_DIR.glob("*2026*gpkg.zip"))
    if not archives:
        return None
    archive = archives[0]
    actual_hash = _sha256(archive)
    if actual_hash != GPKG_ARCHIVE_SHA256:
        raise BuildError(
            f"Checksum mismatch for {archive.name}: {actual_hash}; "
            f"expected {GPKG_ARCHIVE_SHA256}"
        )
    with zipfile.ZipFile(archive) as zipped:
        members = [name for name in zipped.namelist() if name.lower().endswith(".gpkg")]
        if len(members) != 1:
            raise BuildError(f"Expected one GeoPackage in {archive}, found {len(members)}")
        destination = RAW_DIR / Path(members[0]).name
        if not destination.exists():
            temporary = destination.with_suffix(destination.suffix + ".tmp")
            print(f"Extracting preferred GeoPackage ({zipped.getinfo(members[0]).file_size / 1e9:.2f} GB) …")
            with zipped.open(members[0]) as source, temporary.open("wb") as target:
                shutil.copyfileobj(source, target, length=8 * 1024 * 1024)
            os.replace(temporary, destination)
        return destination


def _find_shapefiles() -> tuple[list[Path], Path] | None:
    ground: list[Path] = []
    for suffix in ("OST", "WEST"):
        matches = sorted(RAW_DIR.glob(f"*TLM_BODENBEDECKUNG_{suffix}.shp"))
        if len(matches) != 1:
            return None
        ground.append(matches[0])
    shores = sorted(RAW_DIR.glob("*TLM_STEHENDES_GEWAESSER.shp"))
    return (ground, shores[0]) if len(shores) == 1 else None


def _download_required_shapefiles() -> tuple[list[Path], Path]:
    try:
        from remotezip import RemoteZip
    except ImportError as exc:
        raise BuildError(
            "Source data is missing and remotezip is not installed. Run "
            "`python3 -m pip install -r requirements.txt`."
        ) from exc

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    print("Downloading the required feature classes from the official swisstopo archive …")
    try:
        with RemoteZip(ARCHIVE_URL) as archive:
            infos = archive.infolist()
            for base in SHAPEFILE_BASES:
                for suffix in SHAPEFILE_SUFFIXES:
                    filename = base + suffix
                    matches = [info for info in infos if info.filename.replace("\\", "/").endswith("/" + filename)]
                    if len(matches) != 1:
                        raise BuildError(f"Could not uniquely locate {filename} in the official archive")
                    info = matches[0]
                    destination = RAW_DIR / filename
                    if destination.exists() and destination.stat().st_size == info.file_size:
                        continue
                    temporary = destination.with_suffix(destination.suffix + ".tmp")
                    print(f"  {filename} ({info.compress_size / 1e6:.1f} MB compressed)")
                    with archive.open(info) as source, temporary.open("wb") as target:
                        shutil.copyfileobj(source, target, length=8 * 1024 * 1024)
                    os.replace(temporary, destination)
    except BuildError:
        raise
    except Exception as exc:
        raise BuildError(
            "Could not download swissTLM3D. Download "
            "swisstlm3d_2026-02_2056_5728.gpkg.zip from swisstopo, extract its "
            f"GeoPackage into {RAW_DIR}, and run the build again. Original error: {exc}"
        ) from exc

    found = _find_shapefiles()
    if found is None:
        raise BuildError("Downloaded source files are incomplete")
    return found


def _discover_gpkg_layers(path: Path) -> tuple[list[str], str]:
    layers = [str(row[0]) for row in pyogrio.list_layers(path)]
    # The 2026 GeoPackage uses topic-qualified names such as
    # ``tlm_bb_bodenbedeckung`` whereas the Shapefile feature class is named
    # ``swissTLM3D_TLM_BODENBEDECKUNG_OST``. Discover by semantic suffix and
    # report the actual name instead of assuming either packaging convention.
    ground = sorted(name for name in layers if "BODENBEDECKUNG" in name.upper())
    shores = sorted(name for name in layers if "STEHENDES_GEWAESSER" in name.upper())
    if not ground or len(shores) != 1:
        raise BuildError(
            f"Required layers not found in {path}. Actual layers: {', '.join(layers)}"
        )
    return ground, shores[0]


def _source_specification() -> tuple[list[tuple[Path, str | None]], tuple[Path, str | None], str]:
    gpkg = _find_extracted_gpkg() or _extract_local_gpkg_zip()
    if gpkg is not None:
        ground_layers, shore_layer = _discover_gpkg_layers(gpkg)
        return ([(gpkg, layer) for layer in ground_layers], (gpkg, shore_layer), f"GeoPackage: {gpkg.name}")

    shapefiles = _find_shapefiles() or _download_required_shapefiles()
    ground_files, shore_file = shapefiles
    return ([(path, None) for path in ground_files], (shore_file, None), "official Shapefile distribution")


def _read_layer(path: Path, layer: str | None, **kwargs: object) -> gpd.GeoDataFrame:
    return pyogrio.read_dataframe(path, layer=layer, **kwargs)


def _read_standing_water(
    sources: list[tuple[Path, str | None]],
) -> gpd.GeoDataFrame:
    frames: list[gpd.GeoDataFrame] = []
    for path, layer in sources:
        info = pyogrio.read_info(path, layer=layer)
        field_names = {str(field).upper(): str(field) for field in info["fields"]}
        missing = {"UUID", "OBJEKTART"} - set(field_names)
        if missing:
            raise BuildError(f"{path}:{layer or '<default>'} misses attributes {sorted(missing)}")
        if _horizontal_epsg(info["crs"]) != 2056:
            raise BuildError(f"{path}:{layer or '<default>'} is not in EPSG:2056")

        attributes = _read_layer(
            path,
            layer,
            columns=[field_names["UUID"], field_names["OBJEKTART"]],
            read_geometry=False,
            fid_as_index=True,
        ).rename(columns={field_names["UUID"]: "UUID", field_names["OBJEKTART"]: "OBJEKTART"})
        mask = attributes["OBJEKTART"].map(_is_standing_water)
        feature_ids = attributes.index[mask].to_numpy()
        if not len(feature_ids):
            values = sorted(str(value) for value in attributes["OBJEKTART"].dropna().unique())
            raise BuildError(
                f"No standing waters found in {path}:{layer or '<default>'}; "
                f"actual OBJEKTART values include {values[:20]}"
            )
        frame = _read_layer(
            path,
            layer,
            columns=[field_names["UUID"]],
            fids=feature_ids,
            force_2d=True,
        ).rename(columns={field_names["UUID"]: "UUID"}).to_crs(2056)
        frames.append(frame)
        matched_values = sorted(str(value) for value in attributes.loc[mask, "OBJEKTART"].unique())
        print(
            f"  {info['layer_name']}: {len(frame)} standing-water polygons "
            f"(OBJEKTART matched value(s): {', '.join(matched_values)}; model code 10)"
        )

    waters = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=2056)
    if waters["UUID"].duplicated().any():
        duplicates = waters.loc[waters["UUID"].duplicated(False), "UUID"].tolist()
        raise BuildError(f"Duplicate source UUIDs: {duplicates[:10]}")
    return waters


def _read_shores(source: tuple[Path, str | None]) -> gpd.GeoDataFrame:
    path, layer = source
    info = pyogrio.read_info(path, layer=layer)
    required = {"UUID", "NAME", "GEWISS_NR", "GWL_NR", "LINST"}
    field_names = {str(field).upper(): str(field) for field in info["fields"]}
    if required - set(field_names):
        raise BuildError(f"{path}:{layer or '<default>'} misses attributes {sorted(required - set(field_names))}")
    if _horizontal_epsg(info["crs"]) != 2056:
        raise BuildError(f"{path}:{layer or '<default>'} is not in EPSG:2056")
    shores = _read_layer(
        path,
        layer,
        columns=[field_names[name] for name in sorted(required)],
        force_2d=True,
    ).rename(columns={field_names[name]: name for name in required}).to_crs(2056)
    print(
        f"  {info['layer_name']}: {len(shores)} shoreline segments; "
        f"{int(shores['NAME'].notna().sum())} carry a name"
    )
    return shores.reset_index(drop=True)


def _attach_shore_metadata(waters: gpd.GeoDataFrame, shores: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    # The TLM shore segments share their coordinates exactly with the land-cover
    # polygon rings. This is more reliable than a nearest-neighbour/name guess.
    pairs = shores.sindex.query(waters.geometry.boundary, predicate="intersects")
    candidates = pd.DataFrame({"water_index": pairs[0], "shore_index": pairs[1]})
    candidates = candidates.join(shores.drop(columns="geometry"), on="shore_index")

    matched = candidates["water_index"].nunique()
    if matched != len(waters):
        raise BuildError(f"Only {matched} of {len(waters)} water polygons match TLM shore metadata")
    ambiguous = candidates.groupby("water_index")["GEWISS_NR"].nunique(dropna=True)
    if (ambiguous > 1).any():
        raise BuildError(f"Ambiguous GEWISS_NR for {(ambiguous > 1).sum()} water polygons")

    metadata = candidates.groupby("water_index", sort=True).agg(
        name=("NAME", _mode),
        gewiss_nr=("GEWISS_NR", _mode),
        gwl_nr=("GWL_NR", _mode),
        shore_source_ids=("UUID", _join_distinct),
        country=("LINST", _countries_from_linst),
    )
    return waters.join(metadata)


def _source_lake_id(uuid: object) -> str:
    value = str(uuid).strip().strip("{}").lower()
    return f"swisstlm3d_{value}"


def _merge_border_lakes(waters: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    waters = waters.copy()
    waters["gewiss_int"] = pd.to_numeric(waters["gewiss_nr"], errors="coerce").astype("Int64")
    border_rows: list[dict[str, object]] = []
    used = pd.Series(False, index=waters.index)

    for lake_id, specification in BORDER_LAKES.items():
        selected = waters["gewiss_int"].isin(specification["gewiss"])
        part = waters.loc[selected]
        expected_parts = len(specification["gewiss"])
        if len(part) != expected_parts:
            raise BuildError(
                f"{lake_id}: expected {expected_parts} swissTLM3D polygon(s) for "
                f"GEWISS {sorted(specification['gewiss'])}, found {len(part)}"
            )
        used |= selected
        geometry = shapely.union_all(part.geometry.array)
        border_rows.append(
            {
                "lake_id": lake_id,
                "name": specification["name"],
                "country": specification["countries"],
                "border_lake": True,
                "source": SOURCE_LABEL,
                "source_year": SOURCE_YEAR,
                "source_feature_id": "|".join(sorted(part["UUID"].astype(str))),
                "gewiss_nr": "|".join(str(value) for value in sorted(specification["gewiss"])),
                "gwl_nr": _join_distinct(part["gwl_nr"]),
                "geometry": geometry,
            }
        )

    ordinary = waters.loc[~used].copy()
    ordinary["lake_id"] = ordinary["UUID"].map(_source_lake_id)
    ordinary["border_lake"] = False
    ordinary["source"] = SOURCE_LABEL
    ordinary["source_year"] = SOURCE_YEAR
    ordinary["source_feature_id"] = ordinary["UUID"].astype(str)
    ordinary["gewiss_nr"] = ordinary["gewiss_nr"].map(
        lambda value: str(int(float(value))) if pd.notna(value) else None
    )

    columns = [
        "lake_id",
        "name",
        "country",
        "border_lake",
        "source",
        "source_year",
        "source_feature_id",
        "gewiss_nr",
        "gwl_nr",
        "geometry",
    ]
    border = gpd.GeoDataFrame(border_rows, columns=columns, crs=2056)
    result = gpd.GeoDataFrame(pd.concat([ordinary[columns], border], ignore_index=True), crs=2056)
    return result.sort_values("lake_id", kind="stable").reset_index(drop=True)


def _polygonal_part(geometry: object) -> Polygon | MultiPolygon:
    repaired = shapely.make_valid(geometry)
    if isinstance(repaired, (Polygon, MultiPolygon)):
        return repaired
    polygon_parts = [part for part in shapely.get_parts(repaired) if isinstance(part, (Polygon, MultiPolygon))]
    if not polygon_parts:
        raise BuildError("Geometry repair produced no polygonal component")
    result = shapely.union_all(polygon_parts)
    if not isinstance(result, (Polygon, MultiPolygon)):
        raise BuildError("Geometry repair did not produce Polygon/MultiPolygon")
    return result


def validate_dataset(dataset: gpd.GeoDataFrame) -> dict[str, object]:
    required_properties = {
        "lake_id",
        "name",
        "country",
        "border_lake",
        "source",
        "source_year",
    }
    if required_properties - set(dataset.columns):
        raise BuildError(f"Final dataset misses properties {sorted(required_properties - set(dataset.columns))}")
    if _horizontal_epsg(dataset.crs) != 4326:
        raise BuildError(f"Final CRS is {dataset.crs}, expected EPSG:4326")
    if dataset.empty:
        raise BuildError("Final dataset is empty")
    if dataset.geometry.isna().any() or dataset.geometry.is_empty.any():
        raise BuildError("Final dataset contains null or empty geometries")
    geometry_types = set(dataset.geom_type)
    if not geometry_types <= {"Polygon", "MultiPolygon"}:
        raise BuildError(f"Non-polygon geometries found: {sorted(geometry_types)}")
    if not bool(dataset.geometry.is_valid.all()):
        raise BuildError(f"Final dataset contains {(~dataset.geometry.is_valid).sum()} invalid geometries")
    if bool(dataset.geometry.has_z.any()):
        raise BuildError("Final dataset still contains Z coordinates")
    if dataset["lake_id"].duplicated().any():
        raise BuildError("lake_id is not unique")
    valid_country = dataset["country"].map(
        lambda value: isinstance(value, list)
        and bool(value)
        and all(isinstance(country, str) and len(country) == 2 for country in value)
    )
    if not valid_country.all():
        raise BuildError("Every country property must be a non-empty ISO-code array")
    if not dataset["source_year"].eq(SOURCE_YEAR).all():
        raise BuildError(f"Every source_year must equal {SOURCE_YEAR}")

    normalised_wkb = shapely.to_wkb(shapely.normalize(dataset.geometry.array), hex=True)
    if pd.Series(normalised_wkb).duplicated().any():
        raise BuildError("Final dataset contains duplicate geometries")

    overlap_pairs = dataset.sindex.query(dataset.geometry, predicate="overlaps")
    overlap_count = int((overlap_pairs[0] < overlap_pairs[1]).sum())
    if overlap_count:
        raise BuildError(f"Final dataset contains {overlap_count} overlapping feature pair(s)")

    polygon_parts = shapely.get_parts(dataset.geometry.array)
    interior_ring_count = int(shapely.get_num_interior_rings(polygon_parts).sum())
    if not interior_ring_count:
        raise BuildError("No interior rings found; source islands may have been lost")

    metric = dataset.to_crs(2056)
    border_report: dict[str, dict[str, object]] = {}
    for lake_id, specification in BORDER_LAKES.items():
        rows = dataset.loc[dataset["lake_id"].eq(lake_id)]
        if len(rows) != 1:
            raise BuildError(f"{lake_id}: expected exactly one final feature, found {len(rows)}")
        row = rows.iloc[0]
        if row["country"] != specification["countries"] or not bool(row["border_lake"]):
            raise BuildError(f"{lake_id}: incorrect border metadata")
        area_km2 = float(metric.loc[rows.index].area.iloc[0] / 1_000_000)
        minimum, maximum = specification["area_km2"]
        if not minimum <= area_km2 <= maximum:
            raise BuildError(f"{lake_id}: implausible area {area_km2:.2f} km²")
        actual_bounds = row.geometry.bounds
        expected_bounds = specification["bounds"]
        tolerance = 0.02
        if any(abs(actual - expected) > tolerance for actual, expected in zip(actual_bounds, expected_bounds)):
            raise BuildError(
                f"{lake_id}: bounds {tuple(round(v, 5) for v in actual_bounds)} do not "
                "show the expected complete transboundary extent"
            )
        border_report[lake_id] = {
            "name": specification["name"],
            "area_km2": round(area_km2, 3),
            "countries": specification["countries"],
            "bounds": [round(value, 6) for value in actual_bounds],
        }

    return {
        "features": len(dataset),
        "valid_geometries": int(dataset.geometry.is_valid.sum()),
        "invalid_geometries": int((~dataset.geometry.is_valid).sum()),
        "named_features": int(dataset["name"].notna().sum()),
        "interior_rings": interior_ring_count,
        "overlapping_feature_pairs": overlap_count,
        "border_lakes": border_report,
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_output(dataset: gpd.GeoDataFrame, output: Path) -> str:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    dataset.to_file(
        temporary,
        driver="GeoJSON",
        engine="pyogrio",
        RFC7946="YES",
        COORDINATE_PRECISION=8,
    )
    os.replace(temporary, output)
    return _sha256(output)


def _write_manifest(report: dict[str, object], output: Path, output_hash: str, source_description: str) -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "build": "python3 tools/build_lakes.py",
        "release": RELEASE,
        "source_input": source_description,
        "source_release_asset_sha256": (
            GPKG_ARCHIVE_SHA256 if source_description.startswith("GeoPackage:") else SHAPEFILE_ARCHIVE_SHA256
        ),
        "source_crs": "EPSG:2056+5728 (reduced to 2D EPSG:2056)",
        "output": str(output.relative_to(ROOT)),
        "output_crs": "OGC:CRS84 / EPSG:4326 longitude, latitude",
        "output_sha256": output_hash,
        **report,
    }
    temporary = MANIFEST_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, MANIFEST_PATH)


def _print_report(report: dict[str, object], output: Path) -> None:
    print("\nLake dataset build completed\n")
    print(f"Features: {report['features']}")
    print(f"Valid geometries: {report['valid_geometries']}")
    print(f"Invalid geometries: {report['invalid_geometries']}")
    print(f"Named features: {report['named_features']}")
    print("\nBorder lakes:")
    for entry in report["border_lakes"].values():
        countries = ", ".join(entry["countries"])
        print(f"✓ {entry['name']}: {entry['area_km2']:.3f} km² ({countries})")
    print(f"\nOutput:\n{output.relative_to(ROOT)}")


def build(output: Path) -> dict[str, object]:
    print(f"Building {RELEASE}")
    ground_sources, shore_source, source_description = _source_specification()
    print(f"Input: {source_description}")
    print("Verified layers:")
    waters = _read_standing_water(ground_sources)
    shores = _read_shores(shore_source)
    waters = _attach_shore_metadata(waters, shores)
    dataset = _merge_border_lakes(waters)

    invalid = ~dataset.geometry.is_valid
    if invalid.any():
        print(f"Repairing {int(invalid.sum())} invalid source geometries …")
        dataset.loc[invalid, "geometry"] = dataset.loc[invalid, "geometry"].map(_polygonal_part)
    dataset = dataset.to_crs(4326)
    report = validate_dataset(dataset)
    output_hash = _write_output(dataset, output)

    # Re-open the produced file: this catches serialization/driver errors before
    # replacing the provenance manifest.
    reopened = gpd.read_file(output, engine="pyogrio")
    if len(reopened) != len(dataset) or _horizontal_epsg(reopened.crs) != 4326:
        raise BuildError("Serialized GeoJSON failed the load/count/CRS verification")

    _write_manifest(report, output, output_hash, source_description)
    _print_report(report, output)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="GeoJSON output path")
    args = parser.parse_args()
    output = args.output.resolve()
    try:
        build(output)
    except (BuildError, OSError, ValueError) as exc:
        print(f"Lake dataset build failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
