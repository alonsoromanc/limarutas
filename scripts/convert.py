# scripts/convert.ipynb — Celda para escribir la salida en data/raw/converted
# Lee corredores.json desde /data (lo busca) y escribe GeoJSON en:
#   1) data/raw/converted/corredores.json   (mismo nombre, contenido GeoJSON)
#   2) data/raw/converted/corredores.geojson (misma data, extensión clara)

import json
from pathlib import Path

# =========================
# Resolver ROOT del proyecto
# =========================
def resolve_project_root():
    cwd = Path.cwd()
    if (cwd / "scripts").exists() and (cwd / "data").exists():
        return cwd
    if cwd.name == "scripts" and (cwd.parent / "data").exists():
        return cwd.parent
    for p in cwd.parents:
        if (p / "data").exists():
            return p
    return cwd

ROOT = resolve_project_root()

# =========================
# Localizar INPUT
# =========================
NAME = "corredores.json"

# Candidatos más probables
CANDIDATES = [
    ROOT / "data" / "raw" / "osm" / NAME,
    ROOT / "data" / "raw" / NAME,
]

IN_PATH = None
for c in CANDIDATES:
    if c.exists():
        IN_PATH = c
        break

# Búsqueda recursiva si no se encontró
if IN_PATH is None:
    data_root = ROOT / "data"
    matches = list(data_root.rglob(NAME)) if data_root.exists() else []
    if matches:
        IN_PATH = matches[0]

if IN_PATH is None:
    raise FileNotFoundError(
        f"No se encontró {NAME} en /data. Intenté en: {', '.join(str(p) for p in CANDIDATES)} y búsqueda recursiva en {data_root if (ROOT / 'data').exists() else ROOT}."
    )

# =========================
# Definir OUTPUTS en /data/raw/converted
# =========================
OUT_DIR = ROOT / "data" / "raw" / "converted"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_SAME_NAME = OUT_DIR / NAME             # .../converted/corredores.json  (mismo nombre)
OUT_GEOJSON   = OUT_DIR / "corredores.geojson"  # .../converted/corredores.geojson

print("Working dir:", Path.cwd())
print("ROOT:", ROOT)
print("IN_PATH:", IN_PATH)
print("OUT_DIR:", OUT_DIR)

# =========================
# Detectores de formato
# =========================
def is_geojson(data: dict) -> bool:
    return isinstance(data, dict) and data.get("type") == "FeatureCollection" and isinstance(data.get("features"), list)

def is_overpass_osm(data: dict) -> bool:
    return isinstance(data, dict) and isinstance(data.get("elements"), list)

# =========================
# Utilidades de conversión Overpass → GeoJSON
# =========================
def lonlat_from_node(node):
    return [node["lon"], node["lat"]]

def coords_from_way(way, nodes_by_id):
    # Prefiere 'geometry' si viene de 'out geom'; si no, resuelve por ids
    if "geometry" in way and way["geometry"]:
        return [[pt["lon"], pt["lat"]] for pt in way["geometry"]]
    coords = []
    for nid in way.get("nodes", []):
        n = nodes_by_id.get(nid)
        if n:
            coords.append([n["lon"], n["lat"]])
    return coords

def looks_like_area(tags):
    if not tags:
        return False
    if tags.get("area") == "yes":
        return True
    area_keys = {
        "building","landuse","amenity","leisure","natural",
        "waterway","aeroway","boundary","place"
    }
    return any(k in tags for k in area_keys)

def feature_from_node(node):
    props = dict(node.get("tags", {}))
    props.update({"_osm_type": "node", "_osm_id": node["id"]})
    geom = {"type": "Point", "coordinates": lonlat_from_node(node)}
    return {"type": "Feature", "geometry": geom, "properties": props}

def feature_from_way(way, nodes_by_id):
    coords = coords_from_way(way, nodes_by_id)
    if not coords:
        return None
    props = dict(way.get("tags", {}))
    props.update({"_osm_type": "way", "_osm_id": way["id"]})
    is_closed = len(coords) >= 4 and coords[0] == coords[-1]
    if is_closed and looks_like_area(props):
        geom = {"type": "Polygon", "coordinates": [coords]}
    else:
        geom = {"type": "LineString", "coordinates": coords}
    return {"type": "Feature", "geometry": geom, "properties": props}

def feature_from_relation_as_multilinestring(rel, ways_by_id, nodes_by_id):
    lines = []
    for m in rel.get("members", []):
        if m.get("type") != "way":
            continue
        w = ways_by_id.get(m.get("ref"))
        if not w:
            continue
        coords = coords_from_way(w, nodes_by_id)
        if coords:
            lines.append(coords)
    if not lines:
        return None
    props = dict(rel.get("tags", {}))
    props.update({"_osm_type": "relation", "_osm_id": rel["id"]})
    geom = {"type": "MultiLineString", "coordinates": lines}
    return {"type": "Feature", "geometry": geom, "properties": props}

def build_indexes(elements):
    nodes_by_id, ways_by_id, relations = {}, {}, []
    for el in elements:
        t = el.get("type")
        if t == "node":
            nodes_by_id[el["id"]] = el
        elif t == "way":
            ways_by_id[el["id"]] = el
        elif t == "relation":
            relations.append(el)
    return nodes_by_id, ways_by_id, relations

def convert_overpass_to_geojson(
    data,
    include_points=False,
    include_ways=True,
    include_relations=True,
    only_routes=False
):
    elements = data.get("elements", [])
    nodes_by_id, ways_by_id, relations = build_indexes(elements)

    features = []
    if include_points:
        for node in nodes_by_id.values():
            f = feature_from_node(node)
            if f:
                features.append(f)
    if include_ways:
        for way in ways_by_id.values():
            f = feature_from_way(way, nodes_by_id)
            if f:
                features.append(f)
    if include_relations:
        for rel in relations:
            if only_routes and not (rel.get("tags", {}).get("type") == "route"):
                continue
            f = feature_from_relation_as_multilinestring(rel, ways_by_id, nodes_by_id)
            if f:
                features.append(f)

    return {"type": "FeatureCollection", "features": features}

# =========================
# Ejecutar
# =========================
with IN_PATH.open("r", encoding="utf-8") as f:
    data = json.load(f)

if is_geojson(data):
    geojson = data
else:
    if not is_overpass_osm(data):
        raise ValueError("El archivo no es GeoJSON ni JSON de Overpass (no tiene 'elements').")
    geojson = convert_overpass_to_geojson(
        data,
        include_points=False,
        include_ways=True,
        include_relations=True,
        only_routes=False
    )

# Escribir en ambos nombres en /data/raw/converted
for out_path in (OUT_SAME_NAME, OUT_GEOJSON):
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)
    print(f"✔ Guardado: {out_path}")

print(f"Features: {len(geojson.get('features', []))}")
