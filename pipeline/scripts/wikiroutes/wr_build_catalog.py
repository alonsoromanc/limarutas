from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Dict, List
from urllib.parse import urljoin

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

from wr_scrape import scrape_route, make_driver, DEFAULT_BASE

CATALOG_URL = "https://wikiroutes.info/es/lima/catalog"

# Raíz del proyecto: pipeline/scripts/wikiroutes/ está a 3 niveles de ROOT
ROOT = Path(__file__).resolve().parents[3]

# Rutas derivadas del ROOT
OUT_ROOT = ROOT / "data" / "processed" / "transporte"
WR_MAP_JSON = ROOT / "pipeline" / "output" / "wr_map.json"
WR_OVERRIDES_JSON = ROOT / "config" / "wr_overrides.json"

# Límite de nuevas rutas a descargar. None = sin límite (bajar todo).
MAX_NUEVAS = None


def normalizar(texto: str) -> str:
    return " ".join(texto.split())


def esperar_chips(driver, timeout: int = 60) -> None:
    """
    Espera a que haya al menos un chip de ruta en la página.
    Busca cualquier tipo de ruta (urbana, suburbana, interurbana).
    """
    wait = WebDriverWait(driver, timeout)
    wait.until(
        EC.presence_of_element_located(
            (By.CSS_SELECTOR, "a.tag-btn.tag-btn--float")
        )
    )


def expandir_listas(driver, timeout: int = 60) -> None:
    """
    Hace clic en todos los botones 'Expandir la lista' visibles
    hasta que no quede ninguno.
    """
    wait = WebDriverWait(driver, timeout)

    try:
        wait.until(
            EC.presence_of_element_located(
                (By.CSS_SELECTOR, "div.button-more.expandFullList")
            )
        )
    except TimeoutException:
        return

    while True:
        botones = [
            b
            for b in driver.find_elements(
                By.CSS_SELECTOR, "div.button-more.expandFullList"
            )
            if b.is_displayed()
        ]
        if not botones:
            break

        for b in botones:
            try:
                driver.execute_script("arguments[0].click();", b)
            except Exception:
                pass

        time.sleep(1)


def obtener_links_rutas(driver) -> List[Dict[str, str]]:
    """
    Devuelve lista de dicts {name, url} para todas las rutas visibles,
    sin filtrar por tipo (city / suburban / intercity).
    """
    chips = driver.find_elements(By.CSS_SELECTOR, "a.tag-btn.tag-btn--float")
    rutas = []
    vistos = set()

    for chip in chips:
        if not chip.is_displayed():
            continue

        txt = normalizar(chip.text)
        href = chip.get_attribute("href") or ""
        if not href:
            href = chip.get_attribute("data-href") or ""

        if not href:
            continue

        href_abs = urljoin(DEFAULT_BASE, href)
        if href_abs in vistos:
            continue

        vistos.add(href_abs)
        rutas.append({"name": txt, "url": href_abs})

    return rutas


def cargar_json_si_existe(path: Path):
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def guardar_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)


# Patrones para extraer el código de ruta desde el título de Wikiroutes.
# Intento 1: código con prefijo de empresa (IM34A, IO75a, EM58b, SO18, etc.)
_RE_PREFIJO = re.compile(
    r"Ruta de autob[uú]s\s+([A-Z]{1,4}\d+[a-z]?\b)", re.IGNORECASE
)
# Intento 2: código alfanumérico al inicio del título (1244, 015p, 301ex, etc.)
_RE_INICIO = re.compile(r"^\s*([0-9A-Za-z]+(?:ex|p|pb|pa)?)\b")


def extraer_display_id(title: str) -> str:
    """
    Extrae el código legible de la ruta a partir del título de Wikiroutes.

    Ejemplos:
        'Ruta de autobús IM34A en el mapa de Lima' -> 'IM34A'
        'Ruta de autobús IO75a (Lima - Callao) ...' -> 'IO75a'
        '1244 · Villa Las Palmas → Pan de Azúcar'  -> '1244'
        '015p (Lima - San Bartolomé)'               -> '015p'
    """
    if not title:
        return ""
    m = _RE_PREFIJO.search(title)
    if m:
        return m.group(1)
    m = _RE_INICIO.match(title)
    if m:
        return m.group(1)
    return title


def obtener_color_desde_geojson(route_dir: Path) -> str | None:
    """
    Lee route_track.geojson y devuelve el primer color encontrado en properties.
    """
    gpath = route_dir / "route_track.geojson"
    if not gpath.exists():
        return None

    try:
        with gpath.open("r", encoding="utf-8") as f:
            fc = json.load(f)
    except Exception:
        return None

    for feat in fc.get("features", []):
        props = feat.get("properties", {}) or {}
        color = props.get("color")
        if color:
            return color
    return None


def actualizar_wr_jsons(
    route_dir: Path,
    wr_map: Dict,
    wr_overrides: Dict,
) -> None:
    """
    Actualiza wr_map y wr_overrides para una carpeta route_XXXXXX ya scrapeada.
    Requiere route.json, summary.json y route_track.geojson dentro de route_dir.
    """
    meta_path = route_dir / "route.json"
    summary_path = route_dir / "summary.json"

    if not meta_path.exists():
        print(f"[WARN] No se encontró {meta_path}, se omite esta ruta.")
        return

    with meta_path.open("r", encoding="utf-8") as f:
        meta = json.load(f)

    title = meta.get("title") or ""
    route_id = meta.get("route_id") or ""
    url = meta.get("url") or ""
    city = meta.get("city") or ""

    display_id = extraer_display_id(title)
    color = obtener_color_desde_geojson(route_dir) or "#000000"

    trips_detected = 1
    if summary_path.exists():
        with summary_path.open("r", encoding="utf-8") as f:
            summary = json.load(f)
        try:
            trips_detected = max(1, int(summary.get("trips_detected", 1)))
        except Exception:
            trips_detected = 1

    route_folder_key = route_dir.name  # 'route_154193'

    wr_overrides[route_folder_key] = {
        "display_id": display_id,
        "color": color,
        "name": title,
    }

    if route_id:
        wr_overrides[route_id] = {
            "display_id": display_id,
            "color": color,
        }

    routes_map = wr_map.setdefault("routes", {})

    # Ruta relativa al ROOT del repo (ej. "data/processed/transporte/route_154193")
    folder_rel = route_dir.relative_to(ROOT).as_posix()

    for trip in range(1, trips_detected + 1):
        if trips_detected == 1:
            suffix_key = ""
            suffix_label = ""
        else:
            if trip == 1 and trips_detected == 2:
                suffix_key = "-ida"
                suffix_label = " (ida)"
            elif trip == 2 and trips_detected == 2:
                suffix_key = "-vuelta"
                suffix_label = " (vuelta)"
            else:
                suffix_key = f"-trip{trip}"
                suffix_label = f" (trip {trip})"

        map_key = f"{display_id}{suffix_key}"

        routes_map[map_key] = {
            "folder": folder_rel,
            "trip": trip,
            "color": color,
            "name": title + suffix_label,
            "url": url,
            "city": city,
        }


def main():
    OUT_ROOT.mkdir(parents=True, exist_ok=True)

    existentes_antes = [p for p in OUT_ROOT.glob("route_*") if p.is_dir()]
    total_antes = len(existentes_antes)
    print(f"Carpetas de rutas ya existentes: {total_antes}")

    driver = make_driver(headless=False, lang="es-ES")
    wait = WebDriverWait(driver, 60)

    try:
        driver.get(CATALOG_URL)
        time.sleep(3)

        try:
            tab_todas = wait.until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, "span#tabs-btn-1"))
            )
            driver.execute_script("arguments[0].click();", tab_todas)
        except TimeoutException:
            pass

        esperar_chips(driver)
        expandir_listas(driver)

        rutas_activas = obtener_links_rutas(driver)
        print(f"Total rutas activas: {len(rutas_activas)}")

        label_inactivas = wait.until(
            EC.element_to_be_clickable(
                (By.CSS_SELECTOR, "label[for='checkboxShowInactive']")
            )
        )
        driver.execute_script("arguments[0].click();", label_inactivas)
        time.sleep(2)

        expandir_listas(driver)

        rutas_totales = obtener_links_rutas(driver)
        print(f"Total rutas totales (activas + inactivas): {len(rutas_totales)}")

        set_activas = {r["name"] for r in rutas_activas}
        rutas_inactivas = [r for r in rutas_totales if r["name"] not in set_activas]
        print(f"Total rutas inactivas: {len(rutas_inactivas)}")

    finally:
        driver.quit()

    wr_map = cargar_json_si_existe(WR_MAP_JSON)
    wr_overrides = cargar_json_si_existe(WR_OVERRIDES_JSON)

    existentes_ids = {
        p.name.replace("route_", "") for p in existentes_antes
    }

    nuevas_descargadas = 0

    for idx, ruta in enumerate(rutas_totales, start=1):
        nombre = ruta["name"]
        url = ruta["url"]

        m = re.search(r"routes=(\d+)", url)
        route_id = m.group(1) if m else None

        if route_id and route_id in existentes_ids:
            print(f"[{idx}/{len(rutas_totales)}] Ya existe route_{route_id}, se omite ({nombre}).")
            continue

        if MAX_NUEVAS is not None and nuevas_descargadas >= MAX_NUEVAS:
            print(f"\nSe alcanzó el límite de {MAX_NUEVAS} nuevas rutas. Se detiene.")
            break

        print(f"\n[{idx}/{len(rutas_totales)}] Scrapeando ruta nueva: {nombre} -> {url}")

        try:
            out_dir = scrape_route(url, OUT_ROOT, headless=True)
        except Exception as e:
            print(f"[ERROR] Falló scrape_route para {url}: {e}")
            continue

        try:
            actualizar_wr_jsons(out_dir, wr_map, wr_overrides)
        except Exception as e:
            print(f"[WARN] No se pudo actualizar JSONs para {out_dir}: {e}")

        nuevas_descargadas += 1

    guardar_json(WR_MAP_JSON, wr_map)
    guardar_json(WR_OVERRIDES_JSON, wr_overrides)

    existentes_despues = [p for p in OUT_ROOT.glob("route_*") if p.is_dir()]
    total_despues = len(existentes_despues)

    print("\nResumen descarga:")
    print(f"  Carpetas antes:   {total_antes}")
    print(f"  Carpetas después: {total_despues}")
    print(f"  Nuevas en esta corrida: {total_despues - total_antes}")

    print("\nArchivos actualizados:")
    print(f"  {WR_MAP_JSON}")
    print(f"  {WR_OVERRIDES_JSON}")


if __name__ == "__main__":
    main()