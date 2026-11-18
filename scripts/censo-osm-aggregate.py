#!/usr/bin/env python3
"""
Asigna puntos deportivos OSM a concellos (fase 0 DESENO-V2).
Agrupa pistas a <60 m e escribe data/instalacions-por-concello.json.
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.prepared import prep

SPORT_TYPE = {
    "padel": "padel",
    "paddle": "padel",
    "tennis": "tenis",
    "basketball": "baloncesto",
    "soccer": "futbol",
    "football": "futbol",
    "futsal": "futbol",
    "athletics": "atletismo",
    "running": "atletismo",
    "swimming": "piscina",
    "multi": "multi",
    "volleyball": "volei",
    "handball": "balonman",
    "gymnastics": "sala",
    "fitness": "sala",
}

LEISURE_TYPE = {
    "sports_centre": "pavillon",
    "sports_hall": "pavillon",
    "stadium": "campo",
    "track": "atletismo",
    "pitch": "pista",
}

TYPE_LABEL = {
    "padel": "Pistas de pádel",
    "tenis": "Pistas de tenis",
    "baloncesto": "Pistas de baloncesto",
    "futbol": "Campos de fútbol",
    "atletismo": "Atletismo",
    "piscina": "Piscinas",
    "multi": "Pistas polideportivas",
    "volei": "Voleibol",
    "balonman": "Balonmán",
    "sala": "Salas / fitness",
    "pavillon": "Pavillóns / centros deportivos",
    "campo": "Estadios / campos",
    "pista": "Pistas",
}


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """a,b = (lon, lat) → metros."""
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def classify(props: dict) -> str:
    sport = (props.get("sport") or "").split(";")[0].strip().lower()
    if sport in SPORT_TYPE:
        return SPORT_TYPE[sport]
    leisure = props.get("leisure") or ""
    if leisure in LEISURE_TYPE:
        return LEISURE_TYPE[leisure]
    building = props.get("building") or ""
    if building in ("sports_hall", "sports_centre"):
        return "pavillon"
    return "pista"


def main() -> int:
    if len(sys.argv) < 4:
        print(
            "uso: censo-osm-aggregate.py <deporte.geojson> <concellos.geojson> <out.json> [extract-date]",
            file=sys.stderr,
        )
        return 2
    deporte_path = Path(sys.argv[1])
    concellos_path = Path(sys.argv[2])
    out_path = Path(sys.argv[3])
    extract_date = sys.argv[4] if len(sys.argv) > 4 else datetime.now(timezone.utc).date().isoformat()

    geo = json.loads(concellos_path.read_text(encoding="utf-8"))
    deporte = json.loads(deporte_path.read_text(encoding="utf-8"))

    # prepared polygons
    polys: list[tuple[str, str, str, object]] = []
    for f in geo["features"]:
        p = f["properties"]
        ine = str(p["ine"])
        g = shape(f["geometry"])
        polys.append((ine, p["name"], p["province"], prep(g)))

    # assign features → ine
    by_ine: dict[str, list[dict]] = defaultdict(list)
    unassigned = 0
    for feat in deporte["features"]:
        props = feat["properties"]
        if props.get("leisure") == "fitness_centre":
            continue
        lon, lat = feat["geometry"]["coordinates"]
        pt = Point(lon, lat)
        tipo = classify(props)
        hit = None
        for ine, name, province, pg in polys:
            if pg.contains(pt):
                hit = (ine, name, province)
                break
        if not hit:
            unassigned += 1
            continue
        ine, name, province = hit
        by_ine[ine].append(
            {
                "lon": lon,
                "lat": lat,
                "tipo": tipo,
                "name": props.get("name"),
                "leisure": props.get("leisure"),
                "osmId": props.get("osmId"),
            }
        )

    # ensure all 313 keys exist
    out: dict[str, dict] = {}
    for ine, name, province, _ in polys:
        out[ine] = {
            "name": name,
            "province": province,
            "count": 0,
            "facilities": [],
        }

    CLUSTER_M = 60.0
    ANCHOR_LEISURE = {"sports_centre", "sports_hall", "stadium", "track"}

    for ine, items in by_ine.items():
        anchors = [x for x in items if x["leisure"] in ANCHOR_LEISURE]
        pitches = [x for x in items if x not in anchors]

        # absorb pitches within 60m of an anchor
        absorbed: set[int] = set()
        clusters: list[dict] = []
        for a in anchors:
            members = [a]
            for i, p in enumerate(pitches):
                if i in absorbed:
                    continue
                if haversine_m((a["lon"], a["lat"]), (p["lon"], p["lat"])) <= CLUSTER_M:
                    members.append(p)
                    absorbed.add(i)
            clusters.append({"members": members, "seed": a})

        # remaining pitches: greedy 60m clustering
        remaining = [p for i, p in enumerate(pitches) if i not in absorbed]
        used: set[int] = set()
        for i, p in enumerate(remaining):
            if i in used:
                continue
            members = [p]
            used.add(i)
            for j, q in enumerate(remaining):
                if j in used:
                    continue
                if haversine_m((p["lon"], p["lat"]), (q["lon"], q["lat"])) <= CLUSTER_M:
                    members.append(q)
                    used.add(j)
            clusters.append({"members": members, "seed": p})

        # build facilities summary by type + points
        type_counts: dict[str, int] = defaultdict(int)
        points: list[list] = []
        for cl in clusters:
            seed = cl["seed"]
            tipo = seed["tipo"]
            # if mixed, prefer non-pista type from members
            types = [m["tipo"] for m in cl["members"]]
            for t in types:
                if t != "pista":
                    tipo = t
                    break
            type_counts[tipo] += 1
            for m in cl["members"]:
                points.append([round(m["lon"], 6), round(m["lat"], 6), m["tipo"]])

        facilities = []
        for tipo, n in sorted(type_counts.items(), key=lambda x: (-x[1], x[0])):
            label = TYPE_LABEL.get(tipo, tipo)
            fac: dict = {"name": label if n == 1 else f"{label} ({n})", "type": tipo}
            if tipo in ("padel", "tenis", "baloncesto") and n > 1:
                fac["courts"] = n
            facilities.append(fac)

        row = out[ine]
        row["count"] = len(clusters)
        row["facilities"] = facilities[:6]
        row["_points"] = points  # movido a ficheiro aparte abaixo

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    points_out: dict[str, list] = {}
    for ine, row in out.items():
        pts = row.pop("_points", [])
        if pts:
            points_out[ine] = pts
        # generatedAt só no meta (mantén o JSON principal <150 kB)

    total_points = sum(len(v) for v in points_out.values())
    meta = {
        "_meta": {
            "source": "OpenStreetMap via Geofabrik galicia-latest.osm.pbf",
            "extractDate": extract_date,
            "generatedAt": generated_at,
            "license": "ODbL",
            "attribution": "© colaboradores de OpenStreetMap, ODbL",
            "unassignedPoints": unassigned,
            "rawFeatures": len(deporte["features"]),
            "pointsFile": "instalacions-puntos.json",
            "pointCount": total_points,
            "label": "instalacións deportivas públicas e privadas (OSM)",
            "note": "Sen leisure=fitness_centre. Piscinas no censo pero non como filtro na UI. Puntos noutro ficheiro.",
        }
    }

    # Compacto (<150 kB): sen points e sen indentación.
    out_path.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    points_path = out_path.with_name("instalacions-puntos.json")
    points_path.write_text(
        json.dumps(points_out, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    meta_path = out_path.with_name("instalacions-por-concello.meta.json")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    total = sum(r["count"] for r in out.values())
    main_kb = out_path.stat().st_size / 1024
    print(f"concellos={len(out)} instalacions={total} unassigned={unassigned}")
    print(f"→ {out_path} ({main_kb:.1f} kB)")
    print(f"puntos={total_points} → {points_path}")
    print(f"meta → {meta_path}")
    if main_kb > 150:
        print(f"AVISO: JSON principal {main_kb:.1f} kB > 150 kB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
