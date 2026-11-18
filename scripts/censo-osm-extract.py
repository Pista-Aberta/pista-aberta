#!/usr/bin/env python3
"""
Extracto OSM → GeoJSON de puntos deportivos (fase 0 DESENO-V2).
Require: pyosmium (venv). Entrada: PBF de Galicia. Saída: deporte.geojson (FeatureCollection).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import osmium

LEISURE = {
    "sports_centre",
    "sports_hall",
    "pitch",
    "stadium",
    "track",
    # fitness_centre excluído (xinasios privados; non son pistas do concello)
}
BUILDING = {"sports_hall", "sports_centre"}


def tags_of(obj) -> dict[str, str]:
    return {t.k: t.v for t in obj.tags}


def relevant(tags: dict[str, str]) -> bool:
    leisure = tags.get("leisure")
    building = tags.get("building")
    if leisure in LEISURE:
        return True
    if building in BUILDING:
        return True
    return False


class Handler(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.features: list[dict] = []

    def _add(self, osm_id: str, lon: float, lat: float, tags: dict[str, str]) -> None:
        if lon is None or lat is None:
            return
        if not (-9.5 <= lon <= -6.5 and 41.5 <= lat <= 44.0):
            return
        props = {
            "osmId": osm_id,
            "name": tags.get("name"),
            "leisure": tags.get("leisure"),
            "building": tags.get("building"),
            "sport": tags.get("sport"),
            "access": tags.get("access"),
        }
        self.features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": props,
            }
        )

    def node(self, n) -> None:
        tags = tags_of(n)
        if not relevant(tags):
            return
        self._add(f"n{n.id}", n.location.lon, n.location.lat, tags)

    def way(self, w) -> None:
        tags = tags_of(w)
        if not relevant(tags):
            return
        if not w.is_closed() and tags.get("leisure") not in LEISURE:
            return
        try:
            # centroid aproximado dos nós
            locs = [n.location for n in w.nodes if n.location.valid()]
            if not locs:
                return
            lon = sum(l.lon for l in locs) / len(locs)
            lat = sum(l.lat for l in locs) / len(locs)
        except Exception:
            return
        self._add(f"w{w.id}", lon, lat, tags)

    def area(self, a) -> None:
        # areas from multipolygon relations / closed ways (with locations)
        tags = tags_of(a)
        if not relevant(tags):
            return
        try:
            from osmium.geom import create_multipolygon_wkt
        except Exception:
            return
        # Fallback: use outer ring nodes if available via a.from_way()
        # pyosmium Area doesn't always expose easy centroid; skip if no geo
        # Prefer ways+nodes handler above for closed ways.
        return


def main() -> int:
    if len(sys.argv) < 3:
        print("uso: censo-osm-extract.py <galicia.osm.pbf> <deporte.geojson>", file=sys.stderr)
        return 2
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    h = Handler()
    # locations=True needed for way node coords
    h.apply_file(str(src), locations=True, idx="flex_mem")
    fc = {"type": "FeatureCollection", "features": h.features}
    dst.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    print(f"features={len(h.features)} → {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
