# Data sources

## Federal Office of Topography swisstopo — swissTLM3D

- **Provider:** Federal Office of Topography swisstopo
- **Dataset:** swissTLM3D, version 2.4, release `2026-02`
- **Publication date:** 24 February 2026
- **Preferred asset:** `swisstlm3d_2026-02_2056_5728.gpkg.zip`
- **Published SHA-256:**
  `2218054b21c23e1683fb14a80a9c33d811c7e02a891ab4aedaf761b68750206a`
- **Layers used:** `TLM_BODENBEDECKUNG` (polygon geometry, object type 10,
  “Stehende Gewässer”) and `TLM_STEHENDES_GEWAESSER` (official name,
  `GEWISS_NR`, `GWL_NR`, source UUID and responsible authority)
- **Source CRS:** CH1903+ / LV95 + LN02, EPSG:2056+5728. The build explicitly
  removes Z and works in EPSG:2056 before exporting RFC 7946 GeoJSON in WGS84.
- **Coverage used:** every standing-water polygon in the release. swissTLM3D
  covers Switzerland and Liechtenstein; `LINST=FL` is consequently represented
  as country `LI`. No minimum-area filter is applied.
- **Download:** <https://ogd.swisstopo.admin.ch/ch.swisstopo.swisstlm3d>
- **Product documentation:**
  <https://www.swisstopo.admin.ch/en/landscape-model-swisstlm3d>
- **Terms:** swisstopo Open Government Data terms. Use, processing,
  redistribution and commercial use are permitted; attribution is mandatory.
  <https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices>
- **Required attribution:** Federal Office of Topography swisstopo / ©swisstopo

The GeoPackage is the preferred build input. For constrained environments the
builder can range-download only the three required feature classes from the
official 2026 Shapefile distribution. This is a transport-format fallback for
the same swissTLM3D release, not a geometry-source fallback.

The actual 2026 GeoPackage schema is discovered at runtime. In the downloaded
asset the relevant layer names are `tlm_bb_bodenbedeckung` and
`tlm_gewaesser_stehendes_gewaesser`; GDAL exposes the coded `objektart=10`
domain value as the label `Stehende Gewaesser`. The build accepts and reports
both the numeric model value and the decoded German label.

## Complete transboundary lakes

Inspection and measurement of the actual 2026 `TLM_BODENBEDECKUNG` polygons
showed that swissTLM3D already supplies the complete water surface beyond the
national boundary for all four required lakes. Therefore no coarser third-party
geometry is substituted:

| Canonical feature | swissTLM3D components | Countries | Build treatment |
|---|---|---|---|
| Bodensee | `GEWISS_NR` 9326 (Obersee/Überlinger See) and 10014 (Untersee) | CH, DE, AT | Combined as one valid MultiPolygon |
| Genfersee / Lac Léman | `GEWISS_NR` 9757 | CH, FR | Complete source polygon retained |
| Lago Maggiore / Langensee | `GEWISS_NR` 9711 | CH, IT | Complete source polygon retained |
| Luganersee / Lago di Lugano | `GEWISS_NR` 9710 | CH, IT | Complete source polygon retained |

The build checks the expected full-lake bounds and broad published-area ranges.
These checks detect clipping or accidental source changes but never reshape the
source geometry. Islands remain interior rings. The two topologically separate
Bodensee standing-water polygons are not artificially connected across the
Seerhein.

No geometric simplification is performed. GeoJSON coordinates are rounded only
to 8 decimal degrees (roughly millimetre resolution), well below the source's
survey accuracy, to avoid meaningless projection noise.

The repository's existing `LICENSE` is unchanged. These source terms and the
mandatory swisstopo attribution apply independently to the derived geodata.

## Federal Office of Topography swisstopo, swissBOUNDARIES3D

- **Dataset:** swissBOUNDARIES3D, release `2026-01`
- **Asset:** `swissboundaries3d_2026-01_2056_5728.gpkg.zip`
- **Published SHA-256:**
  `68e922353c76fa5db3cef06a32f9711c0198faa6fbd2b5bcde9edc88b0f8999f`
- **Layer used:** `tlm_landesgebiet`, filtered to `ICC=CH`
- **Output:** `Maps/Switzerland_WGS84.geojson`
- **Output SHA-256:**
  `2f7d58f436069163bcf19fcfc6fb0f42ee7af4344a3e01b8c780da1d59884f39`
- **Download:**
  <https://ogd.swisstopo.admin.ch/ch.swisstopo.swissboundaries3d>

The display polygon contains 52,499 source vertices. It is transformed to
WGS84 and rounded to 8 decimal places without geometric simplification. The
official product reports positional accuracy of approximately 0.5 metres.

## Seerhein viewer line

The national display mask would otherwise hide the Seerhein between the two
separate Lake Constance polygons. The viewer therefore draws the two official
`Rhein | Le Rhin | Rein | Reno` paths returned by the GeoAdmin identify service
for `ch.swisstopo.swisstlm3d-gewaessernetz`. The source feature IDs are
`7143193` and `7143194`, both with `GWL_NR=CH0000010000`. Coordinates are kept
in WGS84 at the precision returned by the service and are not simplified.

- **Layer:** `ch.swisstopo.swisstlm3d-gewaessernetz`
- **Provider:** Federal Office of Topography swisstopo
- **Accessed:** 14 September 2026
- **Service:** <https://api3.geo.admin.ch/rest/services/api/MapServer/identify>
