# -*- coding: utf-8 -*-
"""
Scrapeo total de WikiRoutes usando SOLO Selenium 4 + Chrome DevTools Protocol (sin selenium-wire).
Genera por ruta:
- route.json (metadatos)
- stops.csv (paraderos con lat/lon si se encuentran)
- stops.geojson (puntos)
- line_approx.geojson (aprox por sentido si hay ≥2 puntos)
Además guarda:
- page.html (ruta)
- stops_html/<stop_id>.html (paradas)
- api/*.json (todas las respuestas XHR JSON capturadas)
- network_index.json (mapa URL -> archivo guardado)
"""

import re, csv, json, time, argparse, hashlib
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional, Tuple, Dict
from urllib.parse import urlparse, urljoin, parse_qs

import requests
from bs4 import BeautifulSoup

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.common.exceptions import TimeoutException, NoSuchElementException, WebDriverException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

DEFAULT_BASE = "https://wikiroutes.info"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
REQUEST_DELAY_S = 1.0
PAGE_TIMEOUT_S = 30

# Selectores de la vista de ruta
SEL_STOP_BLOCK = ".stops-list-block"
SEL_STOP_HEAD_SMALL = ".stops-list-block-head small"
SEL_STOP_ITEM = ".stops-list-item"
SEL_ROUTE_TITLE = "h1, .MEcFqLPlaQKg.RSZfWQHoH"
SEL_CITY_LABEL = ".vGyZhDoaGCm.khuKVSRut, a[href*='/es/']"
SEL_LAST_EDIT = ".PNkzKgEzLcTwnP, time[datetime]"
SEL_STATS = ".bLKuCSlgiB .MuinWLFvyLRChv"

# Patrones para coordenadas en texto
COORD_PATTERNS = [
    re.compile(r'(?:"|\'|\s)(lat|latitude)\s*[:=]\s*([-]?\d+\.\d+)\s*(?:,|\s).*?(?:lon|lng|longitude)\s*[:=]\s*([-]?\d+\.\d+)', re.I | re.S),
    re.compile(r'LatLng\(\s*([-]?\d+\.\d+)\s*,\s*([-]?\d+\.\d+)\s*\)', re.I),
    re.compile(r'"coordinates"\s*:\s*\[\s*([-]?\d+\.\d+)\s*,\s*([-]?\d+\.\d+)\]'),
    re.compile(r"data-lat=[\"']([-]?\d+\.\d+)[\"'].*?data-lon=[\"']([-]?\d+\.\d+)[\"']", re.I | re.S),
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
        r = requests.get(urljoin(base, "/robots.txt"), timeout=10, headers={"User-Agent": UA})
        if r.status_code != 200:
            return True
        ua = "*"
        blocks = []
        current = None
        for line in r.text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.lower().startswith("user-agent:"):
                current = line.split(":", 1)[1].strip()
            elif line.lower().startswith("disallow:") and (current == ua or current == "*"):
                blocks.append(line.split(":", 1)[1].strip())
        return not any(path.startswith(d) for d in blocks if d)
    except Exception:
        return True

def make_driver(headless: bool = True, lang: str = "es-ES") -> webdriver.Chrome:
    opts = webdriver.ChromeOptions()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1400,900")
    opts.add_argument(f"--user-agent={UA}")
    opts.add_argument(f"--lang={lang}")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)

    # Habilitar logs de rendimiento para recibir eventos del Protocolo DevTools
    opts.set_capability("goog:loggingPrefs", {"performance": "ALL"})

    drv = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
    drv.set_page_load_timeout(PAGE_TIMEOUT_S)

    # Habilitar dominio Network del CDP para poder pedir cuerpos de respuesta
    try:
        drv.execute_cdp_cmd("Network.enable", {"maxResourceBufferSize": 100000000, "maxTotalBufferSize": 100000000})
    except WebDriverException:
        pass
    return drv

def wait_css(drv, css, timeout=PAGE_TIMEOUT_S):
    WebDriverWait(drv, timeout).until(EC.presence_of_element_located((By.CSS_SELECTOR, css)))

def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")

def get_route_id_from_canonical(s: BeautifulSoup) -> Optional[str]:
    lk = s.find("link", rel="canonical")
    if not lk or not lk.get("href"):
        return None
    q = parse_qs(urlparse(lk["href"]).query)
    return q.get("routes", [None])[0]

def parse_route_meta(s: BeautifulSoup, url: str) -> RouteData:
    rid = get_route_id_from_canonical(s)
    title_el = s.select_one(SEL_ROUTE_TITLE)
    title = title_el.get_text(" ", strip=True) if title_el else None
    ref = None
    if title:
        m = re.search(r"([A-Za-z\-]+|\d+)$", title)
        if m:
            ref = m.group(1)
    last_edit_el = s.select_one(SEL_LAST_EDIT)
    last_edit = last_edit_el.get_text(" ", strip=True) if last_edit_el else None
    city_el = s.select_one(SEL_CITY_LABEL)
    city = city_el.get_text(" ", strip=True) if city_el else None
    stats = [el.get_text(" ", strip=True) for el in s.select(SEL_STATS)] or []

    operator = None
    for dt in s.select("dt"):
        if "Operador" in dt.get_text(" ", strip=True):
            dd = dt.find_next("dd")
            operator = dd.get_text(" ", strip=True) if dd else None
            break

    return RouteData(
        route_id=rid, ref=ref, name=title, operator=operator,
        last_edit=last_edit, stats_raw=stats, city=city, url=url
    )

def extract_stops_from_dom(drv, base: str) -> List[RouteStop]:
    stops: List[RouteStop] = []
    blocks = drv.find_elements(By.CSS_SELECTOR, SEL_STOP_BLOCK)
    for blk in blocks:
        try:
            head_small = blk.find_element(By.CSS_SELECTOR, SEL_STOP_HEAD_SMALL)
            direction = head_small.text.strip()
        except NoSuchElementException:
            direction = ""
        links = blk.find_elements(By.CSS_SELECTOR, SEL_STOP_ITEM)
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

def scan_text_for_coords(text: str) -> List[Tuple[float,float]]:
    coords = []
    for pat in COORD_PATTERNS:
        for m in pat.finditer(text):
            try:
                if len(m.groups()) == 2:
                    a, b = float(m.group(1)), float(m.group(2))
                else:
                    a, b = float(m.group(2)), float(m.group(3))
                lat, lon = (a, b) if abs(b) > abs(a) else (b, a)
                coords.append((lat, lon))
            except Exception:
                continue
    seen = set(); uniq = []
    for lat, lon in coords:
        key = (round(lat, 6), round(lon, 6))
        if key in seen: 
            continue
        seen.add(key); uniq.append((lat, lon))
    return uniq

def _flush_perf_logs(drv):
    try:
        drv.get_log("performance")
    except Exception:
        pass

def _collect_network_events(drv) -> List[Dict]:
    try:
        raw = drv.get_log("performance")
    except Exception:
        return []
    events = []
    for e in raw:
        try:
            msg = json.loads(e["message"])["message"]
            events.append(msg)
        except Exception:
            continue
    return events

def save_network_jsons(drv, out_api: Path) -> Dict[str, str]:
    """Guarda cuerpos JSON de respuestas XHR. Devuelve {url: filename}."""
    out_api.mkdir(parents=True, exist_ok=True)
    events = _collect_network_events(drv)
    # Mapear requestId -> url, mime y si terminó
    responses = {}
    finished = set()
    for ev in events:
        m = ev.get("method")
        p = ev.get("params", {})
        if m == "Network.responseReceived":
            r = p.get("response", {})
            url = r.get("url", "")
            mime = (r.get("mimeType") or "").lower()
            req_id = p.get("requestId")
            if req_id:
                responses[req_id] = {"url": url, "mime": mime}
        elif m == "Network.loadingFinished":
            rid = p.get("requestId")
            if rid:
                finished.add(rid)
    index = {}
    for req_id, info in responses.items():
        mime = info["mime"]
        if ("json" not in mime) and ("geojson" not in mime) and ("text/plain" not in mime):
            continue
        if req_id not in finished:
            continue
        try:
            body_obj = drv.execute_cdp_cmd("Network.getResponseBody", {"requestId": req_id})
            txt = body_obj.get("body", "")
            if not txt:
                continue
            h = hashlib.sha1((info["url"] + str(len(txt))).encode()).hexdigest()[:12]
            fname = f"{h}.json"
            (out_api / fname).write_text(txt, encoding="utf-8")
            index[info["url"]] = fname
        except Exception:
            continue
    return index

def try_coords_from_js_state(drv) -> List[Tuple[float,float]]:
    candidates = [
        "window.__NUXT__", "window.__NEXT_DATA__", "window.__INITIAL_STATE__", "window.__DATA__",
        "window.__APP_STATE__", "window.__ROUTE__"
    ]
    found = []
    for expr in candidates:
        try:
            data = drv.execute_script(f"return {expr} || null;")
            if not data:
                continue
            txt = json.dumps(data, ensure_ascii=False)
            found.extend(scan_text_for_coords(txt))
        except Exception:
            continue
    try:
        scripts = drv.find_elements(By.TAG_NAME, "script")
        blob = []
        for s in scripts:
            try:
                blob.append(s.get_attribute("innerText") or "")
            except Exception:
                pass
        if blob:
            found.extend(scan_text_for_coords("\n".join(blob)))
    except Exception:
        pass
    uniq = []; seen = set()
    for lat, lon in found:
        key = (round(lat,6), round(lon,6))
        if key in seen: 
            continue
        seen.add(key); uniq.append((lat, lon))
    return uniq

def save_route_outputs(out_dir: Path, route: RouteData, stops: List[RouteStop]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "route.json").write_text(json.dumps(asdict(route), ensure_ascii=False, indent=2), encoding="utf-8")

    with open(out_dir / "stops.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["sequence","direction","stop_id","stop_name","stop_url","lat","lon"])
        for s in stops:
            wr.writerow([s.sequence, s.direction, s.stop_id, s.stop_name, s.stop_url, s.lat, s.lon])

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

    drv = make_driver(headless=headless)
    try:
        rid = re.sub(r"[^0-9]+", "", parse_qs(urlparse(url).query).get("routes", [""])[0]) or "ruta"
        out_dir = out_root / f"route_{rid}"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "api").mkdir(exist_ok=True, parents=True)
        (out_dir / "stops_html").mkdir(exist_ok=True, parents=True)

        _flush_perf_logs(drv)
        drv.get(url)
        wait_css(drv, SEL_STOP_BLOCK)
        time.sleep(1.2)
        html_route = drv.page_source
        (out_dir / "page.html").write_text(html_route, encoding="utf-8")

        s = soup(html_route)
        route = parse_route_meta(s, url)
        stops = extract_stops_from_dom(drv, base)

        # Capturar XHR de la página de la ruta
        route_net_index = save_network_jsons(drv, out_dir / "api")

        # Visitar cada parada y capturar
        for st in stops:
            if not st.stop_url:
                continue
            _flush_perf_logs(drv)
            drv.get(st.stop_url)
            time.sleep(1.2)
            sid = st.stop_id or f"seq{st.sequence}"
            (out_dir / "stops_html" / f"{sid}.html").write_text(drv.page_source, encoding="utf-8")

            idx = save_network_jsons(drv, out_dir / "api")
            route_net_index.update(idx)

            js_coords = try_coords_from_js_state(drv)
            if js_coords:
                lat, lon = min(js_coords, key=lambda xy: abs(xy[0] + 12.046) + abs(xy[1] + 77.042))
                st.lat, st.lon = lat, lon
            else:
                hits = scan_text_for_coords(drv.page_source)
                if hits:
                    lat, lon = min(hits, key=lambda xy: abs(xy[0] + 12.046) + abs(xy[1] + 77.042))
                    st.lat, st.lon = lat, lon

            time.sleep(REQUEST_DELAY_S)

        save_route_outputs(out_dir, route, stops)
        (out_dir / "network_index.json").write_text(json.dumps(route_net_index, ensure_ascii=False, indent=2), encoding="utf-8")
        return out_dir
    finally:
        drv.quit()

def main():
    ap = argparse.ArgumentParser(description="Scrapeo total de WikiRoutes con Selenium CDP (sin selenium-wire)")
    sub = ap.add_subparsers(dest="cmd")

    rt = sub.add_parser("route", help="Scrapea una ruta específica")
    rt.add_argument("--base", default=DEFAULT_BASE)
    rt.add_argument("--url", required=True)
    rt.add_argument("--out", default="data_wikiroutes")
    rt.add_argument("--headless", type=int, default=0)

    args = ap.parse_args()
    if not args.cmd:
        print("Uso:")
        print("  python wikiroutes_fullscrape_cdp.py route --url 'https://wikiroutes.info/es/lima?routes=154193' --out data_wikiroutes")
        return

    out_root = Path(args.out); out_root.mkdir(parents=True, exist_ok=True)
    if args.cmd == "route":
        scrape_route(args.base.rstrip("/"), args.url, out_root, headless=bool(args.headless))

if __name__ == "__main__":
    main()
