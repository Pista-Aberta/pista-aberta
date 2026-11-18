# Datos de concellos e censo de instalacións

Datos versionados que usa a aplicación: o asistente de alta dun concello (`npm run setup` e o asistente da Deputación) parte deste censo para propor as instalacións, e o mapa de Galicia da web usa os límites municipais. A imaxe Docker da API inclúeos en `/app/data/`.

## Ficheiros

| Ficheiro | Contido |
|---|---|
| `concellos.geojson` | 313 límites municipais de Galicia, simplificados (~255 kB) |
| `instalacions-por-concello.json` | Código INE → `{ name, province, count, facilities[] }` (**&lt; 150 kB**, sen puntos) |
| `instalacions-puntos.json` | Código INE → `[[lon, lat, tipo], …]` (só ao ampliar un concello) |
| `instalacions-por-concello.meta.json` | Procedencia do extracto OSM (data, ODbL, contadores) |

## Procedencia e licenzas

### `concellos.geojson`
- **Fonte xeométrica:** [Concellos_WSG84](https://abertos.sergas.gal/dataset/b99def8a-92f7-46a6-9686-60915fcc447e/resource/b199466b-4b1b-4aa6-856c-a18f381903ff/download/concellos_wsg84.geojson) (Consellería de Sanidade, datos abertos), CRS WGS84, con `CODIGOINE`.
- **Licenza da fonte:** Creative Commons Attribution 4.0.
- **Procesado:** `mapshaper` (MPL-2.0), simplificación Douglas-Peucker ~3 %, precisión 0,0001°, campos `ine` / `name` / `province`.
- **Nomes:** normalizados a orde galega («A Baña» en vez de «Baña, A»).

### Censo OSM (`instalacions-por-concello.json` + `instalacions-puntos.json`)
- **Fonte:** extracto diario [Geofabrik Galicia](https://download.geofabrik.de/europe/spain/galicia-latest.osm.pbf) (**2026-10-25**).
- **Filtro:** `leisure=sports_centre|sports_hall|pitch|stadium|track` e `building=sports_hall|sports_centre` (`scripts/censo-osm-extract.py` + pyosmium). **Sen** `leisure=fitness_centre`.
- **Etiqueta:** instalacións deportivas públicas e privadas (OSM).
- **Asignación:** centroide → punto-en-polígono contra `concellos.geojson`; agrupación de pistas a &lt; 60 m (`scripts/censo-osm-aggregate.py`).
- **Licenza dos datos:** © colaboradores de OpenStreetMap, [ODbL](https://opendatacommons.org/licenses/odbl/).
- **Puntos:** `instalacions-puntos.json` ten a localización de cada instalación, para situalas no mapa ao dar de alta o concello.
- **Piscinas:** aparecen no censo (`type: piscina`) pero **non** se ofrecen como filtro na app.

## Rexenerar

```bash
mkdir -p /tmp/pa-osm && cd /tmp/pa-osm
curl -LO https://download.geofabrik.de/europe/spain/galicia-latest.osm.pbf

python3 -m venv /tmp/pa-osm-venv
/tmp/pa-osm-venv/bin/pip install osmium shapely

cd /path/to/pista-aberta
npx tsx scripts/censo-osm.ts \
  --pbf /tmp/pa-osm/galicia-latest.osm.pbf \
  --extract-date 2026-10-25 \
  --python /tmp/pa-osm-venv/bin/python
```

Data deste paquete: extracto **2026-10-25**, xerado **2026-10-26**.
