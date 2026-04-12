import json
import csv
from pathlib import Path

ROOT = Path('/workspaces/limarutas')

# --- Configuración ---
FILTRAR_RANGO_ATU = True   # False para incluir todas las rutas sin filtro
ATU_MIN = 1001
ATU_MAX = 1300
# ---------------------

master = {}
with open(ROOT / 'pipeline/output/wr_codes_master.csv', encoding='utf-8') as f:
    for row in csv.DictReader(f):
        master[row['route_id']] = row

lista = {}
with open(ROOT / 'pipeline/input/lista_rutas.csv', encoding='utf-8') as f:
    for row in csv.DictReader(f):
        lista[row['codigo_nuevo']] = row

extremes = json.loads((ROOT / 'pipeline/output/wr_extremes.json').read_text(encoding='utf-8'))

rows = []
seen = set()

for rid, conf in master.items():
    codigo = conf['codigo_final']
    if not codigo or codigo in seen:
        continue

    if FILTRAR_RANGO_ATU:
        try:
            n = int(codigo)
            if not (ATU_MIN <= n <= ATU_MAX):
                continue
        except ValueError:
            continue

    seen.add(codigo)

    meta = lista.get(codigo, {})
    ext = extremes.get(rid, {})
    ida = ext.get('ida', {})

    paradero_ini = ida.get('from') or conf.get('end1_start') or ''
    paradero_fin = ida.get('to')   or conf.get('end1_end')   or ''

    rows.append({
        'codigo':           codigo,
        'distrito_origen':  meta.get('distrito_origen', ''),
        'distrito_destino': meta.get('distrito_destino', ''),
        'paradero_inicial': paradero_ini,
        'paradero_final':   paradero_fin,
    })

rows.sort(key=lambda r: int(r['codigo']))

out = ROOT / 'pipeline/output/bibliografia_rutas.csv'
with open(out, 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=['codigo','distrito_origen','distrito_destino','paradero_inicial','paradero_final'])
    w.writeheader()
    w.writerows(rows)

print(f'Rutas escritas: {len(rows)}')
print(f'Archivo: {out}')