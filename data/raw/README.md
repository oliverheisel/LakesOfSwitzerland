# Raw source data

This directory is intentionally ignored by Git. The normal build downloads the
required feature classes from the official swissTLM3D 2026 Shapefile archive
when no local source is available.

The preferred input is the GeoPackage requested for this project. Download
`swisstlm3d_2026-02_2056_5728.gpkg.zip` from the official swisstopo download
page and place it in `data/raw/switzerland/`. The build extracts it and verifies
the actual layer names, fields and CRS. An already extracted
`SWISSTLM3D_2026_LV95_LN02.gpkg` in that directory is also detected.

No manual QGIS step is required. If automatic access to swisstopo is blocked,
the build stops with the expected filename and location instead of substituting
another data source.

