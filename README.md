# LakesOfSwitzerland

A reproducible GeoJSON dataset of all mapped standing water features in
Switzerland, with complete geometries for the major cross-border lakes.

## Interactive map

[Open the interactive map](https://oliverheisel.github.io/LakesOfSwitzerland/)
to explore the complete dataset. Search by name or identifier, select any
polygon and inspect its original vertex count. Selected shorelines are rendered
without client-side geometry simplification. A separate BAFU river order layer
shows rivers with widths based on their Strahler network order. It can be
toggled without changing the downloadable lake dataset. An unsimplified
swissBOUNDARIES3D 2026 vector polygon provides a crisp national outline and a
subtle background highlight for Switzerland. The viewer limits rivers to the
precise Swiss boundary and displays only Swiss lakes plus complete border
lakes. The downloadable master dataset remains unchanged.

The deployment workflow publishes only the viewer and its required data. For a
new repository, select **GitHub Actions** once under **Settings → Pages → Build
and deployment → Source**; subsequent pushes to `main` deploy automatically.

## Dataset

The current master dataset is built from the official **swissTLM3D 2.4,
release 2026** by the Federal Office of Topography swisstopo. Polygon geometry
comes from object type 10 in `TLM_BODENBEDECKUNG`. Names and stable water
identifiers are associated from `TLM_STEHENDES_GEWAESSER` through their shared
shoreline geometry. All standing water polygons are retained without a minimum
area filter.

The Lake Constance, Lake Geneva, Lake Maggiore and Lake Lugano geometries in the
2026 source already cover their complete transboundary water surfaces. The
build gives these lakes canonical IDs and validates their full extent and
countries. The Upper Lake and Lower Lake source polygons of Lake Constance are
represented together without inventing a connection between them.

## Build and test

```bash
python3 -m pip install -r requirements.txt
python3 tools/build_lakes.py
python3 -m pytest
```

The preferred input is the official 2026 GeoPackage described in
[`data/raw/README.md`](data/raw/README.md). If it is absent, the build downloads
only the required feature classes from the official swisstopo Shapefile
distribution. Raw downloads remain ignored by Git.

The versioned output is
[`Maps/LakesOfSwitzerland_WGS84.geojson`](Maps/LakesOfSwitzerland_WGS84.geojson)
in WGS84/RFC 7946 longitude-latitude order. Full source, layer, CRS, licence and
border-lake provenance is documented in [`data/SOURCES.md`](data/SOURCES.md).
The previous manual QGIS approach and the historical per-lake files are no
longer part of the current repository; they remain available through Git
history if needed.
