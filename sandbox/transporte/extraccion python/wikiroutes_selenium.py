# -*- coding: utf-8 -*-
"""
WikiRoutes scraper con Selenium (scrapeo TOTAL de página de ruta o catálogo).

Genera por ruta (carpeta route_<id>/):
- page.html ............................. HTML de la página de la ruta (renderizada)
- assets/ ................................ Descarga de CSS/JS/IMG referenciados (opcional)
- assets_links.txt ....................... Listado de assets detectados
- route.json ............................. Metadatos extraídos (id, ref, nombre, operador, etc.)
- stops.csv .............................. Tabla de paraderos (orden, sentido, id, nombre, url, lat, lon)
- stops.geojson .......................... Puntos de paraderos (si hay lat/lon)
- line_approx.geojson .................... LineString de la ruta (preferencia: polyline detectada; fallback: unir paraderos)
- raw_coords.json ........................ Candidatos de arrays de coordenadas detectados en scripts (debug)
- stops_html/stop_<id>.html .............. HTML de cada parada (si tiene URL)

CLI:
  python wikiroutes_selenium.py catalog --city lima --lang es --out data_wikiroutes --max-pages 30
  python wikiroutes_selenium.py route --url "https://wikiroutes.info/es/lima?routes=154193" --out data_wikiroutes

Parámetros útiles:
  --headless 1|0            Ejecuta Chrome en segundo plano (1 por defecto)
  --download-assets 1|0     Descarga assets referenciados por la página (0 por defecto)
  --delay 1.2               Retardo entre requests a paradas (segundos)
"""

import re
import csv
import json
import time
import argparse
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any
from urllib.parse import urlparse, urljoin, parse_qs

import requests
from bs4 import BeautifulSoup

# Selenium
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

DEFAULT_BASE = "https://wikiroutes.info"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
REQUEST_DELAY_S = 1.2
PAGE_TIMEOUT_S = 30
ASSET_TIMEOUT_S = 20
MAX_ASSET_SIZE_MB = 15

# Selectores y patrones
SEL_STOP_BLOCK = ".stops-list-block"
SEL_STOP_HEAD_SMALL = ".stops-list-block-head small"
SEL_STOP_ITEM = ".stops-list-item"
SEL_ROUTE_TITLE = ".MEcFqLPlaQKg.RSZfWQHoH"
SEL_ROUTE_TITLE_FALL = "h1, .route-title, .header-title, .content-title"
SEL_CITY_LABEL = ".vGyZhDoaGCm.khuKVSRut"
SEL_CITY_LABEL_FALL = ".breadcrumbs a[href*='/es/'], nav a[href*='/es/']"
SEL_LAST_EDIT = ".PNkzKgEzLcTwnP"
SEL_STATS = ".bLKuCSlgiB .MuinWLFvyLRChv"

COORD_PATTERNS = [
    re.compile(r"LatLng\(\s*([-0-9\.]+)\s*,\s*([-0-9\.]+)\s*\)", re.I),
    re.compile(r"['\"]lat['\"]\s*[:=]\s*([-0-9\.]+)\s*,\s*['\"](lon|lng)['\"]\s*[:=]\s*([-0-9\.]+)", re.I),
    re.compile(r"data-lat=\"([-0-9\.]+)\".*?data-lon=\"([-0-9\.]+)\"", re.I | re.S),
]

# Para capturar arrays grandes de coords en scripts: [[-12.0,-77.0], [...], ...]
BIG_COORD_ARRAY = re.compile(
    r"\[\s*\[\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\](?:\s*,\s*\[\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\]){5,}\s*\]"
)

@dataclass
class RouteStop:
    sequence: int
    direction: str
    stop_id: Optional[str]
    stop_name: str
    stop_url: Optional[str]
    lat: Optional[float] = None
    lon: Optional[float] = None

@dataclass
class RouteData:
    route_id: Optional[str]
    ref: Optional[str]
    name: Optional[str]
    operator: Optional[str]
    last_edit: Optional[str]
    stats_raw: List[str]
    city: Optional[str]
    url: str

# -----------------------------
# Utilidades web/robots/assets
# -----------------------------
def robots_allows(base: str, path: str) -> bool:
    try:
        r = requests.get(urljoin(base, "/robots.txt"), timeout=10)
        if r.status_code != 200:
            return True
        ua = "*"
        dis = []
        current = None
        for line in r.text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.lower().startswith("user-agent:"):
                current = line.split(":", 1)[1].strip()
            elif line.lower().startswith("disallow:") and (current == ua or current == "*"):
                dis.append(line.split(":", 1)[1].strip())
        return not any(path.startswith(d) for d in dis if d)
    except Exception:
        return True

def session_headers() -> Dict[str,str]:
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Connection": "keep-alive",
    }

def safe_get(url: str, timeout: int = ASSET_TIMEOUT_S) -> Optional[requests.Response]:
    try:
        r = requests.get(url, headers=session_headers(), timeout=timeout, stream=True)
        if r.status_code == 200:
            size_mb = int(r.headers.get("Content-Length", "0")) / (1024 * 1024)
            if size_mb and size_mb > MAX_ASSET_SIZE_MB:
                return None
            return r
    except Exception:
        return None
    return None

def collect_asset_urls(soup: BeautifulSoup, base_url: str) -> List[str]:
    urls = set()
    # CSS
    for link in soup.select("link[href]"):
        href = link.get("href")
        if href:
            urls.add(urljoin(base_url, href))
    # JS
    for sc in soup.select("script[src]"):
        src = sc.get("src")
        if src:
            urls.add(urljoin(base_url, src))
    # Imágenes
    for img in soup.select("img[src]"):
        src = img.get("src")
        if src:
            urls.add(urljoin(base_url, src))
    return sorted(urls)

def download_assets(urls: List[str], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for u in urls:
        try:
            r = safe_get(u)
            if not r:
                continue
            filename = re.sub(r"[^\w\-.]", "_", urlparse(u).path.split("/")[-1] or "file")
            # separa por tipo
            sub = "img"
            if filename.endswith((".css",)): sub = "css"
            elif filename.endswith((".js",)): sub = "js"
            target = out_dir / sub
            target.mkdir(parents=True, exist_ok=True)
            with open(target / filename, "wb") as f:
                for chunk in r.iter_content(chunk_size=65536):
                    if chunk:
                        f.write(chunk)
        except Exception:
            continue

# -----------------------------
# Selenium helpers
# -----------------------------
def make_driver(headless: bool = True, lang: str = "es-ES") -> webdriver.Chrome:
    opts = webdriver.ChromeOptions()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1400,1000")
    opts.add_argument(f"--user-agent={UA}")
    opts.add_argument(f"--lang={lang}")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
    driver.set_page_load_timeout(PAGE_TIMEOUT_S)
    return driver

def wait_css(driver: webdriver.Chrome, css: str, timeout: int = PAGE_TIMEOUT_S):
    WebDriverWait(driver, timeout).until(EC.presence_of_element_located((By.CSS_SELECTOR, css)))

def click_if_present(driver: webdriver.Chrome, xpath: str) -> bool:
    try:
        el = driver.find_element(By.XPATH, xpath)
        el.click()
        return True
    except Exception:
        return False

def ensure_stops_panel_open(driver: webdriver.Chrome) -> None:
    # Intenta abrir panel "Paradas/Paraderos/Stops" y "Recorrido/Route" si hay tabs
    # Se prueban varios textos comunes
    candidates = [
        "//button[contains(translate(., 'PRDSETOA', 'prdsetoa'), 'paradas')]",
        "//button[contains(translate(., 'PARADEROS', 'paraderos'), 'paraderos')]",
        "//button[contains(translate(., 'STOPS', 'stops'), 'stops')]",
        "//a[contains(translate(., 'PARADAS', 'paradas'), 'paradas')]",
        "//a[contains(translate(., 'PARADEROS', 'paraderos'), 'paraderos')]",
        "//a[contains(translate(., 'STOPS', 'stops'), 'stops')]",
    ]
    for xp in candidates:
        if click_if_present(driver, xp):
            time.sleep(0.4)
            break

def scroll_to_bottom(driver: webdriver.Chrome, max_secs: float = 4.0):
    start = time.time()
    last = 0
    while time.time() - start < max_secs:
        cur = driver.execute_script("return document.body.scrollHeight || 0;")
        if cur == last:
            break
        last = cur
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(0.3)

# -----------------------------
# Parseadores
# -----------------------------
def soup_from_html(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")

def extract_route_id_from_canonical(soup: BeautifulSoup) -> Optional[str]:
    link = soup.find("link", rel="canonical")
    if not link or not link.get("href"):
        return None
    q = parse_qs(urlparse(link["href"]).query)
    return q.get("routes", [None])[0]

def text_or_none(el) -> Optional[str]:
    try:
        return el.get_text(" ", strip=True)
    except Exception:
        return None

def extract_meta_from_route_soup(soup: BeautifulSoup, url: str) -> RouteData:
    route_id = extract_route_id_from_canonical(soup)

    # título/ref
    title_el = soup.select_one(SEL_ROUTE_TITLE) or soup.select_one(SEL_ROUTE_TITLE_FALL)
    title = text_or_none(title_el)
    ref = None
    if title:
        m = re.search(r"([A-Za-z\-]+|\d+)$", title)
        if m: ref = m.group(1)

    # ciudad
    city_el = soup.select_one(SEL_CITY_LABEL) or soup.select_one(SEL_CITY_LABEL_FALL)
    city = text_or_none(city_el)

    # última edición y stats
    last_edit = text_or_none(soup.select_one(SEL_LAST_EDIT))
    stats = [el.get_text(" ", strip=True) for el in soup.select(SEL_STATS)]

    # operador
    operator = None
    for dt in soup.select("dt"):
        if "Operador" in dt.get_text(" ", strip=True) or "Operator" in dt.get_text(" ", strip=True):
            dd = dt.find_next("dd")
            operator = text_or_none(dd)
            break

    return RouteData(
        route_id=route_id, ref=ref, name=title, operator=operator,
        last_edit=last_edit, stats_raw=stats, city=city, url=url
    )

def extract_stops_from_dom(driver: webdriver.Chrome, base: str) -> List[RouteStop]:
    stops: List[RouteStop] = []
    blocks = driver.find_elements(By.CSS_SELECTOR, SEL_STOP_BLOCK)
    # fallback si cambia el selector
    if not blocks:
        ensure_stops_panel_open(driver)
        time.sleep(0.6)
        blocks = driver.find_elements(By.CSS_SELECTOR, SEL_STOP_BLOCK)

    for block in blocks:
        try:
            head_small = block.find_element(By.CSS_SELECTOR, SEL_STOP_HEAD_SMALL)
            direction = head_small.text.strip()
        except NoSuchElementException:
            direction = ""
        links = block.find_elements(By.CSS_SELECTOR, SEL_STOP_ITEM)
        for i, a in enumerate(links, start=1):
            href = a.get_attribute("href") or ""
            stop_id = href.rstrip("/").split("/")[-1] if href else None
            name = a.text.strip()
            stop_url = urljoin(base, href) if href else None
            stops.append(RouteStop(
                sequence=i, direction=direction, stop_id=stop_id,
                stop_name=name, stop_url=stop_url
            ))
    return stops

def try_extract_coords_from_html(html: str) -> List[Tuple[float, float]]:
    # 1) Patrones LatLng(...)
    coords: List[Tuple[float,float]] = []
    for pat in COORD_PATTERNS:
        for m in pat.finditer(html):
            try:
                lat = float(m.group(1))
                lon = float(m.group(2)) if m.lastindex == 2 else float(m.group(3))
                coords.append((lat, lon))
            except Exception:
                continue
    # 2) Arrays grandes [[lat,lon], ...] dentro de scripts
    bigs = []
    for arrm in BIG_COORD_ARRAY.finditer(html):
        text = arrm.group(0)
        try:
            arr = json.loads(text)
            if isinstance(arr, list) and isinstance(arr[0], list) and len(arr) >= 6:
                bigs.append(arr)
        except Exception:
            # si no es JSON válido, intentar eval seguro reemplazando
            try:
                text2 = text.replace(" ", "")
                text2 = re.sub(r"([0-9])\.(?=[0-9])", r"\1.", text2)
                arr = json.loads(text2)
                if isinstance(arr, list) and len(arr) >= 6:
                    bigs.append(arr)
            except Exception:
                pass
    # convertir a lat,lon tuples
    for arr in bigs:
        tmp = []
        for p in arr:
            if not (isinstance(p, list) and len(p) >= 2):
                tmp = []; break
            tmp.append((float(p[0]), float(p[1])))
        if len(tmp) >= 6:
            # elegir el mejor candidato por cercanía a Lima
            # abs(lat) ~ 12, abs(lon) ~ 77; si invertido, swap
            def looks_like_lima(lat, lon):
                return 10 < abs(lat) < 14 and 74 < abs(lon) < 80
            good = sum(looks_like_lima(lat, lon) for lat, lon in tmp)
            if good < len(tmp) // 2:
                # probar swap
                tmp_sw = [(lon, lat) for lat, lon in tmp]
                good_sw = sum(looks_like_lima(lat, lon) for lat, lon in tmp_sw)
                if good_sw > good:
                    tmp = tmp_sw
            # añadir a coords pero marcando que es de una polilínea
            return tmp
    return coords

def enrich_stops_with_coords(driver: webdriver.Chrome, stops: List[RouteStop], out_dir: Path,
                             delay: float = REQUEST_DELAY_S) -> None:
    html_dir = out_dir / "stops_html"
    html_dir.mkdir(parents=True, exist_ok=True)
    for s in stops:
        if not s.stop_url:
            continue
        try:
            driver.get(s.stop_url)
            time.sleep(0.7)
            html = driver.page_source
            # guardar HTML de la parada
            fname = f"stop_{s.stop_id or s.sequence}.html"
            (html_dir / fname).write_text(html, encoding="utf-8", errors="ignore")
            # coordenadas
            found = try_extract_coords_from_html(html)
            if found:
                # tomar la primera si hay varias en la página de la parada
                lat, lon = found[0]
                s.lat, s.lon = lat, lon
        except Exception:
            pass
        time.sleep(delay)

# -----------------------------
# Guardado
# -----------------------------
def save_route_outputs(out_dir: Path, route: RouteData, stops: List[RouteStop],
                       page_html: str, map_coords: List[Tuple[float,float]],
                       assets_urls: List[str], download_assets_flag: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    # HTML principal y assets
    (out_dir / "page.html").write_text(page_html, encoding="utf-8", errors="ignore")
    (out_dir / "assets_links.txt").write_text("\n".join(assets_urls), encoding="utf-8")
    if download_assets_flag:
        download_assets(assets_urls, out_dir / "assets")

    # route.json
    (out_dir / "route.json").write_text(
        json.dumps(asdict(route), ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # stops.csv
    with open(out_dir / "stops.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["sequence","direction","stop_id","stop_name","stop_url","lat","lon"])
        for s in stops:
            wr.writerow([s.sequence, s.direction, s.stop_id, s.stop_name, s.stop_url, s.lat, s.lon])

    # stops.geojson
    gj_pts = {"type":"FeatureCollection","features":[]}
    for s in stops:
        if s.lat is None or s.lon is None:
            continue
        gj_pts["features"].append({
            "type":"Feature",
            "geometry":{"type":"Point","coordinates":[s.lon, s.lat]},
            "properties":{
                "sequence": s.sequence,
                "direction": s.direction,
                "stop_id": s.stop_id,
                "stop_name": s.stop_name
            }
        })
    (out_dir / "stops.geojson").write_text(json.dumps(gj_pts, ensure_ascii=False), encoding="utf-8")

    # line_approx.geojson: preferir polyline detectada; si no, unir paraderos por orden
    features = []
    used_coords = []

    if map_coords and len(map_coords) >= 2:
        # map_coords viene como [(lat,lon), ...] -> pasamos a [lon,lat]
        coords = [[c[1], c[0]] for c in map_coords]
        used_coords = coords
        features.append({
            "type":"Feature",
            "geometry":{"type":"LineString","coordinates":coords},
            "properties":{"source": "inline_polyline"}
        })

        # para debug
        (out_dir / "raw_coords.json").write_text(
            json.dumps({"points": map_coords}, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    if not features:
        dirs: Dict[str, List[Tuple[float,float]]] = {}
        for s in sorted([x for x in stops if x.lat is not None and x.lon is not None], key=lambda z: (z.direction, z.sequence)):
            dirs.setdefault(s.direction or "", []).append((s.lon, s.lat))
        for d, coords in dirs.items():
            if len(coords) >= 2:
                used_coords.extend(coords)
                features.append({
                    "type":"Feature",
                    "geometry":{"type":"LineString","coordinates":coords},
                    "properties":{"direction": d or "both", "source":"stops_chaining"}
                })

    (out_dir / "line_approx.geojson").write_text(
        json.dumps({"type":"FeatureCollection","features":features}, ensure_ascii=False),
        encoding="utf-8"
    )

# -----------------------------
# Scrapeadores
# -----------------------------
def scrape_route(base: str, url: str, out_root: Path, headless: bool = True,
                 download_assets_flag: bool = False, delay: float = REQUEST_DELAY_S) -> Path:
    if not robots_allows(base, urlparse(url).path):
        raise RuntimeError("Robots.txt no permite scrapear esta ruta")

    driver = make_driver(headless=headless)
    try:
        driver.get(url)
        # intentar asegurar panel de paradas abierto y contenido cargado
        ensure_stops_panel_open(driver)
        scroll_to_bottom(driver, max_secs=4.0)
        try:
            wait_css(driver, SEL_STOP_BLOCK, timeout=PAGE_TIMEOUT_S)
        except TimeoutException:
            pass  # seguimos igual: guardaremos page.html para inspección

        # HTML y soup
        page_html = driver.page_source
        soup = soup_from_html(page_html)

        # metadatos
        route = extract_meta_from_route_soup(soup, url)

        # assets
        assets_urls = collect_asset_urls(soup, url)

        # paraderos
        stops = extract_stops_from_dom(driver, base)
        out_dir = out_root / f"route_{route.route_id or re.sub(r'[^A-Za-z0-9_\-]+','_', route.ref or 'ruta')}"
        out_dir.mkdir(parents=True, exist_ok=True)

        # coords de la polilínea en la página principal (si existen)
        map_coords = try_extract_coords_from_html(page_html)

        # enriquecer paraderos con lat/lon y guardar HTML de cada uno
        enrich_stops_with_coords(driver, stops, out_dir, delay=delay)

        # guardar todo
        save_route_outputs(out_dir, route, stops, page_html, map_coords, assets_urls, download_assets_flag)

        print(f"OK: {route.name or route.ref} -> {out_dir}")
        return out_dir
    finally:
        driver.quit()

def find_route_links_in_catalog_page(driver: webdriver.Chrome, url: str, base: str) -> List[str]:
    driver.get(url)
    time.sleep(1.2)
    # intentar lazy load
    scroll_to_bottom(driver, max_secs=3.0)
    anchors = driver.find_elements(By.CSS_SELECTOR, "a")
    links = []
    for a in anchors:
        href = a.get_attribute("href") or ""
        if not href:
            continue
        if "?routes=" in href or re.search(r"/routes/\d+", href):
            links.append(href)
    # fallback por texto de número corto
    if not links:
        for a in anchors:
            txt = (a.text or "").strip()
            if re.fullmatch(r"[A-Za-z0-9\-]{1,8}", txt):
                href = a.get_attribute("href") or ""
                if href:
                    links.append(href)
    base_netloc = urlparse(base).netloc
    links = [u for u in links if urlparse(u).netloc == base_netloc]
    return sorted(set(links))

def scrape_catalog(base: str, city: str, lang: str, out_root: Path, max_pages: int = 30,
                   headless: bool = True, download_assets_flag: bool = False, delay: float = REQUEST_DELAY_S) -> None:
    first_cat_path = f"/{lang}/{city}/catalog"
    if not robots_allows(base, first_cat_path):
        raise RuntimeError("Robots.txt no permite scrapear el catálogo")

    driver = make_driver(headless=headless)
    try:
        seen = set()
        for page in range(1, max_pages + 1):
            cat_url = f"{base}/{lang}/{city}/catalog?page={page}"
            print(f"Catálogo p{page}: {cat_url}")
            links = find_route_links_in_catalog_page(driver, cat_url, base)
            new_links = [u for u in links if u not in seen]
            if not new_links:
                print("No se encontraron más rutas en esta página. Deteniendo.")
                break
            for u in new_links:
                seen.add(u)
                try:
                    print(f"Ruta: {u}")
                    scrape_route(base, u, out_root, headless=headless,
                                 download_assets_flag=download_assets_flag, delay=delay)
                except Exception as e:
                    print(f"[Aviso] Ruta fallida {u}: {e}")
                time.sleep(delay)
    finally:
        driver.quit()

# -----------------------------
# Helpers para uso desde kernel
# -----------------------------
def run_route(url: str, out: str = "data_wikiroutes", base: str = DEFAULT_BASE,
              headless: bool = True, download_assets: bool = False, delay: float = REQUEST_DELAY_S):
    out_root = Path(out); out_root.mkdir(parents=True, exist_ok=True)
    return scrape_route(base.rstrip("/"), url, out_root, headless=headless,
                        download_assets_flag=download_assets, delay=delay)

def run_catalog(city: str = "lima", lang: str = "es", out: str = "data_wikiroutes", base: str = DEFAULT_BASE,
                max_pages: int = 30, headless: bool = True, download_assets: bool = False, delay: float = REQUEST_DELAY_S):
    out_root = Path(out); out_root.mkdir(parents=True, exist_ok=True)
    return scrape_catalog(base.rstrip("/"), city.strip("/"), lang.strip("/"), out_root,
                          max_pages=max_pages, headless=headless,
                          download_assets_flag=download_assets, delay=delay)

# -----------------------------
# CLI
# -----------------------------
def strip_ipykernel_args(argv):
    if not argv:
        return []
    cleaned, skip = [], False
    for a in argv:
        if skip:
            skip = False
            continue
        if a in ("-f", "--f", "--file"):
            skip = True
            continue
        if a.startswith("--f=") or a.startswith("--file=") or a.startswith("-f="):
            continue
        cleaned.append(a)
    return cleaned

def main(argv=None):
    ap = argparse.ArgumentParser(description="Scraper Selenium para WikiRoutes (scrapeo total)")
    sub = ap.add_subparsers(dest="cmd")

    cat = sub.add_parser("catalog", help="Recorre el catálogo de una ciudad")
    cat.add_argument("--base", default=DEFAULT_BASE)
    cat.add_argument("--city", default="lima")
    cat.add_argument("--lang", default="es")
    cat.add_argument("--out", default="data_wikiroutes")
    cat.add_argument("--max-pages", type=int, default=30)
    cat.add_argument("--headless", type=int, default=1)
    cat.add_argument("--download-assets", type=int, default=0)
    cat.add_argument("--delay", type=float, default=REQUEST_DELAY_S)

    rt = sub.add_parser("route", help="Scrapea una ruta específica")
    rt.add_argument("--base", default=DEFAULT_BASE)
    rt.add_argument("--url", required=True)
    rt.add_argument("--out", default="data_wikiroutes")
    rt.add_argument("--headless", type=int, default=1)
    rt.add_argument("--download-assets", type=int, default=0)
    rt.add_argument("--delay", type=float, default=REQUEST_DELAY_S)

    args = ap.parse_args(strip_ipykernel_args(argv))

    if not args.cmd:
        print("Uso:")
        print("  python wikiroutes_selenium.py catalog --city lima --lang es --out data_wikiroutes --download-assets 1")
        print("  python wikiroutes_selenium.py route --url 'https://wikiroutes.info/es/lima?routes=154193' --out data_wikiroutes --download-assets 1")
        return

    out_root = Path(args.out); out_root.mkdir(parents=True, exist_ok=True)

    if args.cmd == "catalog":
        scrape_catalog(args.base.rstrip("/"), args.city.strip("/"), args.lang.strip("/"), out_root,
                       max_pages=args.max_pages, headless=bool(args.headless),
                       download_assets_flag=bool(args.download_assets), delay=float(args.delay))
    elif args.cmd == "route":
        scrape_route(args.base.rstrip("/"), args.url, out_root,
                     headless=bool(args.headless), download_assets_flag=bool(args.download_assets),
                     delay=float(args.delay))

if __name__ == "__main__":
    import sys
    main(sys.argv[1:])
