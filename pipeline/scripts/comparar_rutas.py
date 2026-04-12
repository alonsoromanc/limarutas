"""
comparar_rutas.py
Compara itinerarios ATU (PDFs) vs Wikiroutes (route.html) para detectar
si el codigo nuevo asignado en wr_codes_master.csv corresponde realmente
a la misma ruta fisica.

Uso:
    python3 pipeline/scripts/comparar_rutas.py

Salida:
    pipeline/output/comparacion_rutas.csv
"""

import csv
import re
import sys
import subprocess
from pathlib import Path


def instalar(pkg):
    subprocess.check_call([sys.executable, '-m', 'pip', 'install',
                           pkg, '--break-system-packages', '-q'])


try:
    import pdfplumber
except ImportError:
    instalar('pdfplumber')
    import pdfplumber

try:
    from bs4 import BeautifulSoup
except ImportError:
    instalar('beautifulsoup4')
    from bs4 import BeautifulSoup


ROOT       = Path('/workspaces/limarutas')
PDF_DIR    = ROOT / 'docs/paraderos_ATU/Actualización del Plan Regulador de Rutas'
MASTER_CSV = ROOT / 'pipeline/output/wr_codes_master.csv'
DATA_DIR   = ROOT / 'data/processed/transporte'
OUT_CSV    = ROOT / 'pipeline/output/comparacion_rutas.csv'


# ── Normalizacion ─────────────────────────────────────────────────────────────

STOPWORDS = {
    'avenida', 'calle', 'jiron', 'pasaje', 'ovalo', 'carretera', 'via',
    'auxiliar', 'intercambio', 'vial', 'hacia', 'desde', 'entre',
    'san', 'santa', 'de', 'del', 'la', 'los', 'las', 'el', 'en',
    'alt', 'giro', 'vuelta', 'ida', 'y', 'a', 'con', 'por',
    'puente', 'plaza', 'parque', 'rotonda', 'acceso',
}


def normalizar(texto):
    t = texto.lower()
    for a, b in [('a','a'),('e','e'),('i','i'),('o','o'),('u','u'),('n','n'),
                 ('\xe1','a'),('\xe9','e'),('\xed','i'),('\xf3','o'),('\xfa','u'),('\xf1','n')]:
        t = t.replace(a, b)
    t = re.sub(r'[^a-z0-9\s]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def palabras_clave(texto):
    """
    Extrae palabras con significado de nombre de calle (>4 chars, no stopword).
    Funciona igual para texto ATU en mayusculas y WR en titulo.
    """
    n = normalizar(texto)
    return {w for w in n.split() if len(w) > 4 and w not in STOPWORDS}


def similitud(set_a, set_b):
    if not set_a or not set_b:
        return 0.0
    inter = len(set_a & set_b)
    union = len(set_a | set_b)
    return round(inter / union, 3) if union else 0.0


# ── Leer PDFs ATU ─────────────────────────────────────────────────────────────

def leer_pdf_atu(path):
    nombre      = path.stem
    partes      = nombre.split('_')
    cod_antiguo = partes[1] if len(partes) >= 3 else ''
    cod_nuevo   = partes[2] if len(partes) >= 3 else ''

    texto = ''
    try:
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                texto += (page.extract_text() or '') + '\n'
    except Exception as e:
        return cod_antiguo, cod_nuevo, '', '', '', str(e)

    origen  = re.search(r'DISTRITO DE ORIGEN\s*:\s*(.+)',  texto)
    destino = re.search(r'DISTRITO DE DESTINO\s*:\s*(.+)', texto)
    origen  = origen.group(1).strip()  if origen  else ''
    destino = destino.group(1).strip() if destino else ''

    m = re.search(
        r'ITINERARIO IDA\s+ITINERARIO VUELTA\s*\n([\s\S]+?)'
        r'(?:CARROCERIA|PUNTO INICIAL|LONGITUD|FLOTA|\Z)',
        texto
    )
    itinerario = m.group(1).strip() if m else ''

    return cod_antiguo, cod_nuevo, origen, destino, itinerario, ''


# ── Leer route.html WR ────────────────────────────────────────────────────────

def leer_itinerario_wr(route_id):
    html_path = DATA_DIR / f'route_{route_id}' / 'route.html'
    if not html_path.exists():
        return '', 'no_html'
    try:
        with open(html_path, encoding='utf-8', errors='ignore') as f:
            soup = BeautifulSoup(f, 'html.parser')
        texto = soup.get_text(separator=' ')
        m = re.search(
            r'Itinerario\s*:\s*(.*?)(?:Fechas|Horario|Ciudad|Empresa|\Z)',
            texto, re.DOTALL
        )
        if not m:
            return '', 'no_itinerario'
        itin = m.group(1).strip()
        # Cortar en el primer punto seguido de espacio y mayuscula
        # para no capturar texto de UI que viene despues del itinerario
        corte = re.search(r'\.\s+(?=[A-Z])', itin)
        if corte:
            itin = itin[:corte.start() + 1]
        return itin, ''
    except Exception as e:
        return '', str(e)


# ── Cargar master CSV ─────────────────────────────────────────────────────────

def cargar_master():
    mapping = {}
    with open(MASTER_CSV, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            nuevo = row.get('cand_codigo_nuevo', '').strip()
            rid   = row.get('route_id', '').strip()
            if nuevo and rid:
                mapping.setdefault(nuevo, []).append({
                    'route_id':   rid,
                    'wr_antiguo': row.get('cand_codigo_antiguo', '').strip(),
                    'display_id': row.get('display_id_raw', '').strip(),
                    'end1_start': row.get('end1_start', '').strip(),
                    'end1_end':   row.get('end1_end', '').strip(),
                })
    return mapping


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print(f'PDF_DIR: {PDF_DIR}')
    print(f'Existe: {PDF_DIR.exists()}')
    print('Cargando wr_codes_master.csv...')
    master = cargar_master()

    pdfs = sorted(PDF_DIR.glob('RUTA_*.pdf'))
    print(f'PDFs encontrados: {len(pdfs)}')

    resultados = []

    for pdf_path in pdfs:
        cod_ant, cod_nuevo, ori_atu, des_atu, itin_atu, err_pdf = leer_pdf_atu(pdf_path)

        if not cod_nuevo:
            continue

        try:
            n = int(cod_nuevo)
            if not (1001 <= n <= 1300):
                continue
        except ValueError:
            continue

        kw_atu      = palabras_clave(itin_atu)
        entradas_wr = master.get(cod_nuevo, [])

        if not entradas_wr:
            resultados.append({
                'codigo_nuevo':       cod_nuevo,
                'codigo_antiguo_atu': cod_ant,
                'wr_antiguo':         '',
                'route_id':           '',
                'display_id':         '',
                'origen_atu':         ori_atu,
                'destino_atu':        des_atu,
                'similitud':          '',
                'match_antiguo':      'SIN_ENTRADA_WR',
                'palabras_atu':       ' | '.join(sorted(kw_atu))[:200],
                'palabras_wr':        '',
                'palabras_comunes':   '',
                'error':              err_pdf or 'no_match_en_master',
            })
            continue

        for wr in entradas_wr:
            itin_wr, err_wr = leer_itinerario_wr(wr['route_id'])
            kw_wr  = palabras_clave(itin_wr)
            sim    = similitud(kw_atu, kw_wr)
            comun  = kw_atu & kw_wr

            match_ant = 'OK' if wr['wr_antiguo'] == cod_ant else \
                        f'DIFF(WR:{wr["wr_antiguo"]})'

            resultados.append({
                'codigo_nuevo':       cod_nuevo,
                'codigo_antiguo_atu': cod_ant,
                'wr_antiguo':         wr['wr_antiguo'],
                'route_id':           wr['route_id'],
                'display_id':         wr['display_id'],
                'origen_atu':         ori_atu,
                'destino_atu':        des_atu,
                'similitud':          sim,
                'match_antiguo':      match_ant,
                'palabras_atu':       ' | '.join(sorted(kw_atu))[:200],
                'palabras_wr':        ' | '.join(sorted(kw_wr))[:200],
                'palabras_comunes':   ' | '.join(sorted(comun))[:200],
                'error':              err_pdf or err_wr,
            })

        print(f'  {cod_nuevo} ({cod_ant}) — {len(entradas_wr)} entrada(s) WR')

    resultados.sort(key=lambda r: (
        int(r['codigo_nuevo']) if r['codigo_nuevo'].isdigit() else 9999,
        r['route_id']
    ))

    campos = [
        'codigo_nuevo', 'codigo_antiguo_atu', 'wr_antiguo', 'route_id',
        'display_id', 'origen_atu', 'destino_atu', 'similitud',
        'match_antiguo', 'palabras_atu', 'palabras_wr', 'palabras_comunes',
        'error'
    ]

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_CSV, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        w.writerows(resultados)

    print(f'\nListo. {len(resultados)} filas en {OUT_CSV}')

    sim_vals = [float(r['similitud']) for r in resultados if r['similitud']]
    if sim_vals:
        altos  = sum(1 for s in sim_vals if s >= 0.5)
        medios = sum(1 for s in sim_vals if 0.2 <= s < 0.5)
        bajos  = sum(1 for s in sim_vals if s < 0.2)
        avg    = sum(sim_vals) / len(sim_vals)
        print(f'Similitud promedio: {avg:.3f}')
        print(f'Alta  (>=0.50): {altos}')
        print(f'Media (0.20-0.49): {medios}')
        print(f'Baja  (<0.20): {bajos}')
    diffs  = sum(1 for r in resultados if r['match_antiguo'].startswith('DIFF'))
    sin_wr = sum(1 for r in resultados if r['match_antiguo'] == 'SIN_ENTRADA_WR')
    print(f'DIFF codigo antiguo: {diffs}')
    print(f'Sin entrada WR: {sin_wr}')


if __name__ == '__main__':
    main()