# scripts/convert.ipynb — Mejora de salida GeoJSON
# - Limpia propiedades que no sirven (ej. maxspeed, source, addr:*, etc.)
# - Agrega estilo por color del corredor (stroke, stroke-width, marker-color)
# - Identifica RUTAS (MultiLineString) y PARADAS (Point) por relation (type=route)
# - Escribe en data/raw/converted/corredores.json y corredores.geojson

import json
from pathlib import Path
import re

# =========================
# Resolver raíz del proyecto y paths
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
NAME = "corredores.json"

# Candidatos de entrada
CANDIDATES = [
    ROOT / "data" / "raw" / "osm" / NAME,
    ROOT / "data" / "raw" / NAME,
]

IN_PATH = next((p for p in CANDIDATES if p.exists()), None)
if IN_PATH is None:
    data_root = ROOT / "data"
    matches = list(data_root.rglob(NAME)) if data_root.exists() else []
    IN_PATH = matches[0] if matches else None

if IN_PATH is None:
    raise FileNotFoundError("No encontré el archivo de entrada corredores.json en /data.")

OUT_DIR = ROOT / "data" / "raw" / "converted"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_JSON    = OUT_DIR / NAME                # .../converted/corredores.json
OUT_GEOJSON = OUT_DIR / "corredores.geojson"

print("IN:", IN_PATH)
print("OUT_DIR:", OUT_DIR)

# =========================
# Detectores de formato
# =========================
def is_geojson(obj): 
    return isinstance(obj, dict) and obj.get("type") == "FeatureCollection" and isinstance(obj.get("features"), list)

def is_overpass(obj): 
    return isinstance(obj, dict) and isinstance(obj.get("elements"), list)

# =========================
# Limpieza de propiedades
# =========================
# Claves a eliminar (exactas)
DROP_KEYS = {
    "maxspeed", "max_speed", "source", "created_by", "note", "fixme", "FIXME",
    "is_in", "import_uuid", "check_date", "survey:date", "opening_hours",
    "start_date", "end_date", "change:date", "website", "phone", "email",
    "wikidata", "wikipedia", "short_name", "alt_name", "old_name", "operator:wikidata"
}
# Prefijos a eliminar (addr:*, tiger:*, gnis:*, seamark:* …)
DROP_PREFIXES = ("addr:", "tiger:", "gnis:", "seamark:", "source:", "old_", "contact:", "mapillary")

# Whitelist de claves que sí conservamos (si existen)
KEEP_KEYS = {
    "name", "ref", "type", "route", "network", "operator", "from", "to", "description", "colour", "color"
}

def clean_props(tags: dict) -> dict:
    if not tags:
        return {}
    out = {}
    for k, v in tags.items():
        if k in KEEP_KEYS:
            out[k] = v
            continue
        if k in DROP_KEYS:
            continue
        if any(k.startswith(p) for p in DROP_PREFIXES):
            continue
        # Por defecto, descartar claves no whitelisted para mantener liviano
        # Si quieres ser menos agresivo, comenta el continue y permitir otras:
        # out[k] = v
        continue
    return out

# =========================
# Detección de color por corredor
# =========================
COLOR_MAP = {
    "azul": "#0074D9",
    "rojo": "#FF4136",
    "morado": "#6A3D9A",
    "amarillo": "#FFDC00",
    "verde": "#2ECC40",
    "celeste": "#7FDBFF",
    "naranja": "#FF851B",
    "plata": "#AAAAAA",
    "plateado": "#AAAAAA",
    "gris": "#888888",
    "negro": "#111111",
    "rosa": "#F012BE",
    "blanco": "#DDDDDD"
}
COLOR_WORD_RE = re.compile("|".join(sorted(COLOR_MAP.keys(), key=len, reverse=True)), re.IGNORECASE)

def infer_color_from_text(*texts):
    for t in texts:
        if not t:
            continue
        # Si ya trae un hex válido en colour/color, úsalo
        if isinstance(t, str) and re.fullmatch(r"#?[0-9A-Fa-f]{6}", t.strip()):
            val = t.strip()
            return val if val.startswith("#") else f"#{val}"
        # Buscar palabra de color en español
        m = COLOR_WORD_RE.search(str(t))
        if m:
            key = m.group(0).lower()
            return COLOR_MAP.get(key)
    return None

def infer_route_color(tags: dict) -> str:
    # Prioridades: colour/color → network → name → operator
    c = infer_color_from_text(tags.get("colour") or tags.get("color"))
    if c: return c
    c = infer_color_from_text(tags.get("network"))
    if c: return c
    c = infer_color_from_text(tags.get("name"))
    if c: return c
    c = infer_color_from_text(tags.get("operator"))
    if c: return c
    # Default
    return "#444444"

# =========================
# Overpass → GeoJSON con estilos y paradas
# =========================
def lonlat_from_node(n): 
    return [n["lon"], n["lat"]]

def coords_from_way(way, nodes_by_id):
    if "geometry" in way and way["geometry"]:
        return [[pt["lon"], pt["lat"]] for pt in way["geometry"]]
    coords = []
    for nid in way.get("nodes", []):
        n = nodes_by_id.get(nid)
        if n:
            coords.append([n["lon"], n["lat"]])
    return coords

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

def features_from_relation(rel, ways_by_id, nodes_by_id):
    tags = rel.get("tags", {}) or {}
    clean = clean_props(tags)
    color = infer_route_color(tags)
    stroke_width = 4

    # 1) RUTA como MultiLineString (con estilos)
    lines = []
    for m in rel.get("members", []):
        if m.get("type") == "way":
            w = ways_by_id.get(m.get("ref"))
            if not w: 
                continue
            coords = coords_from_way(w, nodes_by_id)
            if coords:
                lines.append(coords)

    feats = []
    if lines:
        props_route = {
            **clean,
            "_osm_type": "relation",
            "_osm_id": rel["id"],
            "kind": "route",
            "stroke": color,
            "stroke-width": stroke_width,
            "stroke-opacity": 1.0
        }
        feats.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": lines},
            "properties": props_route
        })

    # 2) PARADAS como Point, tomando miembros node con rol stop/platform
    for m in rel.get("members", []):
        if m.get("type") != "node":
            continue
        role = (m.get("role") or "").lower()
        if role not in ("stop", "stop_entry_only", "stop_exit_only", "platform", "platform_entry_only", "platform_exit_only"):
            # si quieres incluir todos los nodos de la relation, comenta esto
            continue
        node = nodes_by_id.get(m.get("ref"))
        if not node:
            continue
        n_tags = node.get("tags", {}) or {}
        n_clean = clean_props(n_tags)
        props_stop = {
            **n_clean,
            "role": role,
            "kind": "stop",
            "route_name": clean.get("name"),
            "route_ref": clean.get("ref"),
            "network": clean.get("network"),
            "marker-color": color,
            "marker-symbol": "bus",
            "_osm_type": "node",
            "_osm_id": node["id"]
        }
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": lonlat_from_node(node)},
            "properties": props_stop
        })

    return feats

def convert_overpass_enhanced(data):
    elements = data.get("elements", [])
    nodes_by_id, ways_by_id, relations = build_indexes(elements)
    out_features = []

    # Solo sacamos relations de tipo route; si quieres incluir ways independientes, puedes añadirlos
    for rel in relations:
        if (rel.get("tags") or {}).get("type") == "route":
            out_features.extend(features_from_relation(rel, ways_by_id, nodes_by_id))

    return {"type": "FeatureCollection", "features": out_features}

# =========================
# Ejecutar: leer → convertir/limpiar → escribir
# =========================
with IN_PATH.open("r", encoding="utf-8") as f:
    data = json.load(f)

if is_geojson(data):
    # GeoJSON de entrada: aplicar limpieza + coloreo por mejor esfuerzo
    features_out = []
    for ft in data.get("features", []):
        props = ft.get("properties", {}) or {}
        clean = clean_props(props)
        # Color por tags existentes
        color = infer_route_color(props)
        kind = props.get("kind")
        geom_type = ft.get("geometry", {}).get("type", "")
        if not kind:
            # inferir kind por geometría
            kind = "route" if geom_type in ("LineString", "MultiLineString") else "stop" if geom_type == "Point" else "feature"
        style = {}
        if kind == "route":
            style = {"stroke": color, "stroke-width": 4, "stroke-opacity": 1.0}
        elif kind == "stop":
            style = {"marker-color": color, "marker-symbol": "bus"}

        new_props = {
            **clean,
            **style,
            "_cleaned": True
        }
        features_out.append({
            "type": "Feature",
            "geometry": ft.get("geometry"),
            "properties": new_props
        })
    geojson = {"type": "FeatureCollection", "features": features_out}
elif is_overpass(data):
    geojson = convert_overpass_enhanced(data)
else:
    raise ValueError("El archivo no es GeoJSON ni JSON de Overpass (no tiene 'elements').")

# Guardar en ambos nombres en /data/raw/converted
for out_path in (OUT_JSON, OUT_GEOJSON):
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)
    print("✔ Guardado:", out_path)

print("Rutas:", sum(1 for ft in geojson["features"] if ft["properties"].get("kind") == "route"))
print("Paradas:", sum(1 for ft in geojson["features"] if ft["properties"].get("kind") == "stop"))
