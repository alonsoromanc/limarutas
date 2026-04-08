#!/usr/bin/env bash
# refactor_pipeline.sh
# Ejecutar desde la raíz del repositorio limarutas/
set -euo pipefail

if [ ! -f "index.html" ] || [ ! -d "pipeline" ]; then
    echo "ERROR: ejecuta desde la raíz del repositorio (limarutas/)."
    exit 1
fi

WR="pipeline/scripts/wikiroutes"

echo "=== 1/4  Creando directorios nuevos ==="
mkdir -p pipeline/input
mkdir -p pipeline/output
mkdir -p data/raw/wikiroutes
touch data/raw/wikiroutes/.gitkeep
echo "  pipeline/input/"
echo "  pipeline/output/"
echo "  data/raw/wikiroutes/"

echo ""
echo "=== 2/4  Moviendo archivos de config/ ==="
move_if_exists() {
    if [ -f "$1" ]; then
        git mv "$1" "$2"
        echo "  mv  $1  →  $2"
    else
        echo "  SKIP (no existe): $1"
    fi
}

move_if_exists "config/lista_rutas.csv"            "pipeline/input/lista_rutas.csv"
move_if_exists "config/wr_map.json"                "pipeline/output/wr_map.json"
move_if_exists "config/wr_extremes.json"           "pipeline/output/wr_extremes.json"
move_if_exists "config/wr_codes_master.csv"        "pipeline/output/wr_codes_master.csv"
move_if_exists "config/unmatched_lista_rutas.json" "pipeline/output/unmatched_routes.json"

echo ""
echo "=== 3/4  Renombrando scripts ==="
git mv "$WR/wikiroutes_leafletgrab.py" "$WR/wr_scrape.py"
echo "  mv  wikiroutes_leafletgrab.py  →  wr_scrape.py"
git mv "$WR/catalog_runner.py"         "$WR/wr_build_catalog.py"
echo "  mv  catalog_runner.py          →  wr_build_catalog.py"
git mv "$WR/build_wr_codes_master.py"  "$WR/wr_build_codes.py"
echo "  mv  build_wr_codes_master.py   →  wr_build_codes.py"
git mv "$WR/build_wr_extremes.py"      "$WR/wr_build_extremes.py"
echo "  mv  build_wr_extremes.py       →  wr_build_extremes.py"
git mv "$WR/sync_wr_indexes.py"        "$WR/wr_sync_indexes.py"
echo "  mv  sync_wr_indexes.py         →  wr_sync_indexes.py"

echo ""
echo "=== 4/4  Patcheando código ==="

python3 - << 'PYEOF'
import json
from pathlib import Path

WR = Path("pipeline/scripts/wikiroutes")

def patch(path: Path, replacements: list):
    txt = path.read_text(encoding="utf-8")
    changed = False
    for old, new in replacements:
        if old in txt:
            txt = txt.replace(old, new, 1)
            changed = True
        else:
            print(f"  WARN: cadena no encontrada en {path.name}:")
            print(f"        {repr(old)}")
    if changed:
        path.write_text(txt, encoding="utf-8")
        print(f"  patched: {path.name}")

# wr_scrape.py
patch(WR / "wr_scrape.py", [
    (
        'default="data_wikiroutes"',
        'default="data/raw/wikiroutes"'
    ),
])

# wr_build_catalog.py
patch(WR / "wr_build_catalog.py", [
    (
        'from wikiroutes_leafletgrab import',
        'from wr_scrape import'
    ),
    (
        'WR_MAP_JSON = ROOT / "config" / "wr_map.json"',
        'WR_MAP_JSON = ROOT / "pipeline" / "output" / "wr_map.json"'
    ),
])

# wr_build_extremes.py
patch(WR / "wr_build_extremes.py", [
    (
        'config_dir = root / "config"\n    config_dir.mkdir(parents=True, exist_ok=True)\n    out_path = config_dir / "wr_extremes.json"',
        'out_dir = root / "pipeline" / "output"\n    out_dir.mkdir(parents=True, exist_ok=True)\n    out_path = out_dir / "wr_extremes.json"'
    ),
])

# wr_build_codes.py
patch(WR / "wr_build_codes.py", [
    (
        '(p / "config" / "lista_rutas.csv").exists()',
        '(p / "pipeline" / "input" / "lista_rutas.csv").exists()'
    ),
    (
        'LISTA_RUTAS_CSV = ROOT / "config" / "lista_rutas.csv"',
        'LISTA_RUTAS_CSV = ROOT / "pipeline" / "input" / "lista_rutas.csv"'
    ),
    (
        'default="config/wr_codes_master.csv"',
        'default="pipeline/output/wr_codes_master.csv"'
    ),
])

# wr_sync_indexes.py
patch(WR / "wr_sync_indexes.py", [
    (
        '(p / "config" / "lista_rutas.csv").exists()',
        '(p / "pipeline" / "input" / "lista_rutas.csv").exists()'
    ),
    (
        'default="config/unmatched_lista_rutas.json"',
        'default="pipeline/output/unmatched_routes.json"'
    ),
    (
        'LISTA_RUTAS_CSV = ROOT / "config" / "lista_rutas.csv"',
        'LISTA_RUTAS_CSV = ROOT / "pipeline" / "input" / "lista_rutas.csv"'
    ),
    (
        'WR_MAP_JSON = ROOT / "config" / "wr_map.json"',
        'WR_MAP_JSON = ROOT / "pipeline" / "output" / "wr_map.json"'
    ),
])

# run_pipeline.ipynb — se carga como JSON para evitar problemas con escapes
nb_path = WR / "run_pipeline.ipynb"
nb = json.loads(nb_path.read_text(encoding="utf-8"))

nb_replacements = [
    # Comandos shell en celdas de código
    ('!python catalog_runner.py',          '!python wr_build_catalog.py'),
    ('!python sync_wr_indexes.py',         '!python wr_sync_indexes.py'),
    ('!python build_wr_codes_master.py',   '!python wr_build_codes.py'),
    ('!python build_wr_extremes.py',       '!python wr_build_extremes.py'),
    # Paths en celda 5 (verificación)
    ('ROOT / "config" / "wr_map.json"',           'ROOT / "pipeline" / "output" / "wr_map.json"'),
    ('ROOT / "config" / "wr_extremes.json"',       'ROOT / "pipeline" / "output" / "wr_extremes.json"'),
    ('ROOT / "config" / "wr_codes_master.csv"',    'ROOT / "pipeline" / "output" / "wr_codes_master.csv"'),
    # Tabla en celda markdown
    ('`catalog_runner.py`',        '`wr_build_catalog.py`'),
    ('`sync_wr_indexes.py`',       '`wr_sync_indexes.py`'),
    ('`build_wr_codes_master.py`', '`wr_build_codes.py`'),
    ('`build_wr_extremes.py`',     '`wr_build_extremes.py`'),
]

for cell in nb.get("cells", []):
    new_source = []
    for line in cell.get("source", []):
        for old, new in nb_replacements:
            line = line.replace(old, new)
        new_source.append(line)
    cell["source"] = new_source

nb_path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
print("  patched: run_pipeline.ipynb")

print("\nTodos los cambios aplicados.")
PYEOF

echo ""
echo "Verifica con:  git status  y  git diff"