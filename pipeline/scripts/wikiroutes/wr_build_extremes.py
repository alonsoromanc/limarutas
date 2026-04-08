from __future__ import annotations

import json
import re
from html import unescape
from pathlib import Path
from collections import Counter


SPAN_ARROW_PATTERN = re.compile(
    r'<span[^>]*>([^<]+)</span>\s*(?:&nbsp;|\u00a0)?\s*(?:→|&rarr;)\s*(?:&nbsp;|\u00a0)?\s*<span[^>]*>([^<]+)</span>'
)


def find_repo_root(start: Path) -> Path:
    """
    Sube desde 'start' hasta encontrar el directorio que contiene
    data/processed/transporte. Ese directorio se toma como raíz del repo.
    """
    cur = start
    for _ in range(8):
        if (cur / "data" / "processed" / "transporte").is_dir():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    raise SystemExit(
        f"No se encontró 'data/processed/transporte' subiendo desde {start}."
    )


def repo_root() -> Path:
    """
    Devuelve la carpeta raíz del repositorio.
    Usa __file__ si existe (script .py), o Path.cwd() en notebook.
    """
    try:
        here = Path(__file__).resolve()
    except NameError:
        here = Path.cwd().resolve()
    return find_repo_root(here)


def clean_label(text: str) -> str:
    if not text:
        return ""
    t = unescape(text)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def extract_pairs_from_html(html: str) -> list[tuple[str, str]]:
    """
    Extrae todos los pares Origen → Destino del HTML de route.html.
    Devuelve lista de tuplas (from, to) ya limpias.
    """
    raw_pairs = SPAN_ARROW_PATTERN.findall(html)
    pairs: list[tuple[str, str]] = []
    for a, b in raw_pairs:
        a_clean = clean_label(a)
        b_clean = clean_label(b)
        if a_clean or b_clean:
            pairs.append((a_clean, b_clean))
    return pairs


def compute_ida_vuelta(pairs: list[tuple[str, str]]) -> dict:
    """
    Deduce el par ida y el par vuelta a partir de la lista de pares.

    Política:
      - Sin pares: ida/vuelta vacíos.
      - Un par (A, B): ida = A→B, vuelta = B→A.
      - Dos pares donde el segundo es el inverso del primero: ida=par0, vuelta=par1.
      - Caso general: toma los nodos que aparecen una sola vez como extremos.
        Si hay exactamente dos extremos E1 y E2: ida=E1→E2, vuelta=E2→E1.
      - Fallback: ida=par0, vuelta=par0 invertido.
    """
    if not pairs:
        return {
            "ida": {"from": "", "to": ""},
            "vuelta": {"from": "", "to": ""},
        }

    if len(pairs) == 1:
        a, b = pairs[0]
        return {
            "ida": {"from": a, "to": b},
            "vuelta": {"from": b, "to": a},
        }

    a1, b1 = pairs[0]
    a2, b2 = pairs[1]

    if a1 == b2 and b1 == a2:
        return {
            "ida": {"from": a1, "to": b1},
            "vuelta": {"from": a2, "to": b2},
        }

    all_nodes = []
    for a, b in pairs:
        all_nodes.append(a)
        all_nodes.append(b)

    counts = Counter(all_nodes)
    extremos = [n for n, c in counts.items() if c == 1]

    if len(extremos) == 2:
        e1, e2 = extremos
        return {
            "ida": {"from": e1, "to": e2},
            "vuelta": {"from": e2, "to": e1},
        }

    return {
        "ida": {"from": a1, "to": b1},
        "vuelta": {"from": b1, "to": a1},
    }


def build_wr_extremes():
    root = repo_root()
    data_dir = root / "data" / "processed" / "transporte"
    out_dir = root / "pipeline" / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    out_path = out_dir / "wr_extremes.json"

    if not data_dir.is_dir():
        raise SystemExit(f"No existe la carpeta de datos: {data_dir}")

    result: dict[str, dict] = {}
    processed = 0
    skipped_no_html = 0
    skipped_no_pairs = 0

    for route_dir in sorted(data_dir.iterdir()):
        if not route_dir.is_dir():
            continue
        name = route_dir.name
        if not name.startswith("route_"):
            continue

        route_id = name.split("_", 1)[1] if "_" in name else name
        html_path = route_dir / "route.html"

        if not html_path.is_file():
            skipped_no_html += 1
            continue

        html = html_path.read_text(encoding="utf-8", errors="ignore")
        pairs = extract_pairs_from_html(html)

        if not pairs:
            skipped_no_pairs += 1
            continue

        ida_vuelta = compute_ida_vuelta(pairs)

        result[route_id] = {
            "pairs": [{"from": a, "to": b} for (a, b) in pairs],
            "ida": ida_vuelta["ida"],
            "vuelta": ida_vuelta["vuelta"],
        }

        processed += 1

    out_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Rutas procesadas: {processed}")
    print(f"Rutas sin route.html: {skipped_no_html}")
    print(f"Rutas sin pares Origen → Destino: {skipped_no_pairs}")
    print(f"Archivo generado: {out_path}")


if __name__ == "__main__":
    build_wr_extremes()