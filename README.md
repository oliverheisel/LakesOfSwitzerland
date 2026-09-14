# LakesOfSwitzerland
Geojson files of all lakes in Switzerland

<img width="1134" height="806" alt="image" src="https://github.com/user-attachments/assets/7d7e21d8-e881-4e57-86a0-95310764a33a" />

## Interactive map

The GitHub Pages viewer at
[oliverheisel.github.io/LakesOfSwitzerland](https://oliverheisel.github.io/LakesOfSwitzerland/)
shows the complete master dataset. Search for a lake or select any polygon to
inspect its identifiers, geometry type, interior rings and exact source vertex
count. The selected shoreline is rendered without client-side simplification at
detailed zoom levels.

The deployment workflow publishes only the viewer and its required data. For a
new repository, select **GitHub Actions** once under **Settings → Pages → Build
and deployment → Source**; subsequent pushes to `main` deploy automatically.

## Lake dataset / LakesOfSwitzerland

The current master dataset is built from the official **swissTLM3D 2.4,
release 2026** by the Federal Office of Topography swisstopo. Polygon geometry
comes from `TLM_BODENBEDECKUNG` (“Stehende Gewässer”, object type 10); names and
stable water identifiers are associated from `TLM_STEHENDES_GEWAESSER` by their
shared shoreline geometry. All standing-water polygons are retained without a
minimum-area filter.

The Bodensee, Genfersee/Lac Léman, Lago Maggiore and Luganersee geometries in
the 2026 source already cover their complete transboundary water surfaces. The
build gives these lakes canonical IDs and validates their full extent and
countries. Bodensee's Obersee and Untersee source polygons are represented
together without inventing a connection between them.

Build and test with:

```bash
python3 -m pip install -r requirements.txt
python3 tools/build_lakes.py
python3 -m pytest
```

The preferred input is the official 2026 GeoPackage described in
[`data/raw/README.md`](data/raw/README.md). If it is absent, the single build
command downloads only the required feature classes from the official
swisstopo Shapefile distribution. Raw downloads remain ignored by Git.

The versioned output is
[`Maps/LakesOfSwitzerland_WGS84.geojson`](Maps/LakesOfSwitzerland_WGS84.geojson)
in WGS84/RFC 7946 longitude-latitude order. Full source, layer, CRS, licence and
border-lake provenance is documented in [`data/SOURCES.md`](data/SOURCES.md).
The previous manual QGIS approach and the historical per-lake files are no
longer part of the current repository; they remain available through Git
history if needed.
