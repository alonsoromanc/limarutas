# -*- coding: utf-8 -*-
"""
WikiRoutes scraper con Selenium.
Genera por ruta:
- route.json
- stops.csv
- stops.geojson
- line_approx.geojson

Requisitos:
pip install selenium webdriver-manager beautifulsoup4 requests
"""

import re, csv, json, time, argparse
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
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " \
     "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
REQUEST_DELAY_S = 1.2
PAGE_TIMEOUT_S = 25

# Selectores conocidos de WikiRoutes
SEL_STOP_BLOCK = ".stops-list-block"
SEL_STOP_HEAD_SMALL = ".stops-list-block-head small"
SEL_STOP_ITEM = ".stops-list-item"
SEL_ROUTE_TITLE = ".MEcFqLPlaQKg.RSZfWQHoH"
SEL_CITY_LABEL = ".vGyZhDoaGCm.khuKVSRut"
SEL_LAST_EDIT = ".PNkzKgEzLcTwnP"
SEL_STATS = ".bLKuCSlgiB .MuinWLFvyLRChv"

COORD_PATTERNS = [
    re.compile(r"LatLng\(\s*([-0-9\.]+)\s*,\s*([-0-9\.]+)\s*\)", re.I),
    re.compile(r"['\"]lat['\"]\s*[:=]\s*([-0-9\.]+)\s*,\s*['\"](lon|lng)['\"]\s*[:=]\s*([-0-9\.]+)", re.I),
    re.compile(r"data-lat=\"([-0-9\.]+)\".*?data-lon=\"([-0-9\.]+)\"", re.I | re.S),
]

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

def make_driver(headless: bool = True, lang: str = "es-ES") -> webdriver.Chrome:
    opts = webdriver.ChromeOptions()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument(f"--user-agent={UA}")
    opts.add_argument(f"--lang={lang}")
    opts.add_argument("--window-size=1360,900")
    # Evitar detecciones triviales
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
    driver.set_page_load_timeout(PAGE_TIMEOUT_S)
    return driver

def page_wait_css(driver: webdriver.Chrome, css: str, timeout: int = PAGE_TIMEOUT_S):
    WebDriverWait(driver, timeout).until(EC.presence_of_element_located((By.CSS_SELECTOR, css)))

def text_or_none(el) -> Optional[str]:
    try:
        return el.text.strip()
    except Exception:
        return None

def soup_from_html(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")

def extract_route_id_from_canonical(soup: BeautifulSoup) -> Optional[str]:
    link = soup.find("link", rel="canonical")
    if not link or not link.get("href"):
        return None
    q = parse_qs(urlparse(link["href"]).query)
    return q.get("routes", [None])[0]

def extract_meta_from_route_soup(soup: BeautifulSoup, url: str) -> RouteData:
    route_id = extract_route_id_from_canonical(soup)
    city = text_or_none(soup.select_one(SEL_CITY_LABEL))
    title = text_or_none(soup.select_one(SEL_ROUTE_TITLE))
    last_edit = text_or_none(soup.select_one(SEL_LAST_EDIT))
    stats = [el.get_text(" ", strip=True) for el in soup.select(SEL_STATS)]
    ref, name = None, None
    if title:
        m = re.search(r"([A-Za-z\-]+|\d+)$", title)
        if m:
            ref = m.group(1)
        name = title
    operator = None
    for dt in soup.select("dt"):
        if "Operador" in dt.get_text(" ", strip=True):
            dd = dt.find_next("dd")
            operator = dd.get_text(" ", strip=True) if dd else None
            break
    return RouteData(
        route_id=route_id, ref=ref, name=name, operator=operator,
        last_edit=last_edit, stats_raw=stats, city=city, url=url
    )

def extract_stops_from_route_dom(driver: webdriver.Chrome, base: str) -> List[RouteStop]:
    stops: List[RouteStop] = []
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

def try_extract_coords_from_html(html: str) -> Optional[Tuple[float, float]]:
    for pat in COORD_PATTERNS:
        m = pat.search(html)
        if m:
            try:
                lat = float(m.group(1))
                lon = float(m.group(2)) if m.lastindex == 2 else float(m.group(3))
                return lat, lon
            except Exception:
                continue
    return None

def enrich_stops_with_coords(driver: webdriver.Chrome, stops: List[RouteStop], delay: float = REQUEST_DELAY_S) -> None:
    for s in stops:
        if not s.stop_url:
            continue
        try:
            driver.get(s.stop_url)
            # una espera corta ayuda si hay JS
            time.sleep(0.5)
            html = driver.page_source
            coords = try_extract_coords_from_html(html)
            if coords:
                s.lat, s.lon = coords
        except Exception:
            pass
        time.sleep(delay)

def save_route_outputs(out_dir: Path, route: RouteData, stops: List[RouteStop]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "route.json").write_text(json.dumps(asdict(route), ensure_ascii=False, indent=2), encoding="utf-8")
    with open(out_dir / "stops.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["sequence","direction","stop_id","stop_name","stop_url","lat","lon"])
        for s in stops:
            wr.writerow([s.sequence, s.direction, s.stop_id, s.stop_name, s.stop_url, s.lat, s.lon])

    # GeoJSON de puntos
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

    # LineString por sentido si hay al menos 2 puntos
    dirs: Dict[str, List[Tuple[float,float]]] = {}
    for s in sorted([x for x in stops if x.lat is not None and x.lon is not None], key=lambda z: z.sequence):
        dirs.setdefault(s.direction or "", []).append((s.lon, s.lat))
    features = []
    for d, coords in dirs.items():
        if len(coords) >= 2:
            features.append({
                "type":"Feature",
                "geometry":{"type":"LineString","coordinates":coords},
                "properties":{"direction": d}
            })
    (out_dir / "line_approx.geojson").write_text(json.dumps({"type":"FeatureCollection","features":features}, ensure_ascii=False), encoding="utf-8")

def scrape_route(base: str, url: str, out_root: Path, headless: bool = True) -> Path:
    if not robots_allows(base, urlparse(url).path):
        raise RuntimeError("Robots.txt no permite scrapear esta ruta")
    driver = make_driver(headless=headless)
    try:
        driver.get(url)
        page_wait_css(driver, SEL_STOP_BLOCK)
        html = driver.page_source
        soup = soup_from_html(html)
        route = extract_meta_from_route_soup(soup, url)
        stops = extract_stops_from_route_dom(driver, base)
        enrich_stops_with_coords(driver, stops, delay=REQUEST_DELAY_S)

        rid = route.route_id or re.sub(r"[^A-Za-z0-9_\-]+", "_", route.ref or "ruta")
        out_dir = out_root / f"route_{rid}"
        save_route_outputs(out_dir, route, stops)
        return out_dir
    finally:
        driver.quit()

def find_route_links_in_catalog_page(driver: webdriver.Chrome, url: str, base: str) -> List[str]:
    driver.get(url)
    time.sleep(1.2)
    anchors = driver.find_elements(By.CSS_SELECTOR, "a")
    links = []
    for a in anchors:
        href = a.get_attribute("href") or ""
        if not href:
            continue
        if "?routes=" in href or re.search(r"/routes/\d+", href):
            links.append(href)
    # fallback: texto que parezca número de ruta
    if not links:
        for a in anchors:
            txt = (a.text or "").strip()
            if re.fullmatch(r"[A-Za-z0-9\-]{1,8}", txt):
                href = a.get_attribute("href") or ""
                if href:
                    links.append(href)
    # normaliza y filtra dominio
    base_netloc = urlparse(base).netloc
    links = [u for u in links if urlparse(u).netloc == base_netloc]
    return sorted(set(links))

def scrape_catalog(base: str, city: str, lang: str, out_root: Path, max_pages: int = 30, headless: bool = True) -> None:
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
                    scrape_route(base, u, out_root, headless=headless)
                except Exception as e:
                    print(f"[Aviso] Ruta fallida {u}: {e}")
                time.sleep(REQUEST_DELAY_S)
    finally:
        driver.quit()

# Helpers Jupyter
def run_route(url: str, out: str = "data_wikiroutes", base: str = DEFAULT_BASE, headless: bool = True):
    out_root = Path(out); out_root.mkdir(parents=True, exist_ok=True)
    return scrape_route(base.rstrip("/"), url, out_root, headless=headless)

def run_catalog(city: str = "lima", lang: str = "es", out: str = "data_wikiroutes", base: str = DEFAULT_BASE, max_pages: int = 30, headless: bool = True):
    out_root = Path(out); out_root.mkdir(parents=True, exist_ok=True)
    return scrape_catalog(base.rstrip("/"), city.strip("/"), lang.strip("/"), out_root, max_pages=max_pages, headless=headless)

# CLI
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
    ap = argparse.ArgumentParser(description="Scraper Selenium para WikiRoutes")
    sub = ap.add_subparsers(dest="cmd")

    cat = sub.add_parser("catalog", help="Recorre el catálogo de una ciudad")
    cat.add_argument("--base", default=DEFAULT_BASE)
    cat.add_argument("--city", default="lima")
    cat.add_argument("--lang", default="es")
    cat.add_argument("--out", default="data_wikiroutes")
    cat.add_argument("--max-pages", type=int, default=30)
    cat.add_argument("--headless", type=int, default=1)

    rt = sub.add_parser("route", help="Scrapea una ruta específica")
    rt.add_argument("--base", default=DEFAULT_BASE)
    rt.add_argument("--url", required=True)
    rt.add_argument("--out", default="data_wikiroutes")
    rt.add_argument("--headless", type=int, default=1)

    args = ap.parse_args(strip_ipykernel_args(argv))

    if not args.cmd:
        print("Uso: wikiroutes_selenium.py [catalog|route] ...")
        print("Ejemplos:\n  python wikiroutes_selenium.py catalog --city lima --lang es --out data_wikiroutes\n  python wikiroutes_selenium.py route --url 'https://wikiroutes.info/es/lima?routes=154193' --out data_wikiroutes")
        return

    out_root = Path(args.out); out_root.mkdir(parents=True, exist_ok=True)

    if args.cmd == "catalog":
        scrape_catalog(args.base.rstrip("/"), args.city.strip("/"), args.lang.strip("/"), out_root, max_pages=args.max_pages, headless=bool(args.headless))
    elif args.cmd == "route":
        scrape_route(args.base.rstrip("/"), args.url, out_root, headless=bool(args.headless))

if __name__ == "__main__":
    import sys
    main(sys.argv[1:])
