# -*- coding: utf-8 -*-
# Extrae el trazado visible de una ruta de WikiRoutes leyendo las capas de Leaflet
# Requisitos:
#   pip install "selenium==4.*" webdriver-manager beautifulsoup4 requests

import re, json, time, argparse
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urljoin

import requests
from bs4 import BeautifulSoup

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

DEFAULT_BASE = "https://wikiroutes.info"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
PAGE_TIMEOUT_S = 30

SEL_MAP_ANY = ".leaflet-pane, #map, .leaflet-container"
SEL_ROUTE_TITLE = "h1, .MEcFqLPlaQKg.RSZfWQHoH"
SEL_CITY_LABEL  = ".vGyZhDoaGCm.khuKVSRut"

def robots_allows(base: str, path: str) -> bool:
    try:
        r = requests.get(urljoin(base, "/robots.txt"), timeout=10)
        if r.status_code != 200: return True
        dis = []
        current = None
        for line in r.text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"): continue
            if line.lower().startswith("user-agent:"):
                current = line.split(":", 1)[1].strip()
            elif line.lower().startswith("disallow:") and (current == "*" or current == None):
                dis.append(line.split(":", 1)[1].strip())
        return not any(path.startswith(d) for d in dis if d)
    except Exception:
        return True

def make_driver(headless=True, lang="es-ES"):
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
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
    driver.set_page_load_timeout(PAGE_TIMEOUT_S)
    return driver

def wait_map_ready(driver):
    WebDriverWait(driver, PAGE_TIMEOUT_S).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, SEL_MAP_ANY))
    )
    # espera a que aparezca al menos 1 polyline en alguna instancia de Leaflet
    def has_lines(drv):
        js = """
        return (function(){
          var map=null;
          for (var k in window){
            try{
              var v=window[k];
              if (v && typeof v.eachLayer==='function' && typeof v.getCenter==='function'){
                map=v; break;
              }
            }catch(e){}
          }
          if(!map) return 0;
          var n=0;
          map.eachLayer(function(l){
            try{
              if (typeof L!=='undefined' && l instanceof L.Polyline && !(l instanceof L.Polygon)){ n++; }
            }catch(e){}
          });
          return n;
        })();
        """
        try:
            n = drv.execute_script(js)
            return int(n) > 0
        except Exception:
            return False
    WebDriverWait(driver, PAGE_TIMEOUT_S).until(lambda d: has_lines(d))

def grab_leaflet_layers(driver):
    js = """
    return (function(){
      function convLatLng(ll){
        if (Array.isArray(ll)){
          // lista de LatLng o listas anidadas
          if (ll.length && ll[0] && typeof ll[0].lat==='number' && typeof ll[0].lng==='number'){
            return ll.map(function(p){ return [p.lng, p.lat]; });
          }
          return ll.map(convLatLng).filter(function(a){ return a && a.length; });
        }
        if (ll && typeof ll.lat==='number' && typeof ll.lng==='number'){
          return [ll.lng, ll.lat];
        }
        return null;
      }
      var out = {lines:[], points:[]};
      var map=null;
      for (var k in window){
        try{
          var v=window[k];
          if (v && typeof v.eachLayer==='function' && typeof v.getCenter==='function'){
            map=v; break;
          }
        }catch(e){}
      }
      if(!map) return out;

      map.eachLayer(function(l){
        try{
          if (typeof L!=='undefined' && l instanceof L.Polyline && !(l instanceof L.Polygon)){
            var latlngs = l.getLatLngs();
            var coords  = convLatLng(latlngs);
            // normaliza a lista de segmentos
            if (!Array.isArray(coords) || coords.length===0) return;
            var segments = (coords.length && typeof coords[0][0] === 'number') ? [coords] : coords;
            out.lines.push({
              color: (l.options && (l.options.color || l.options.strokeColor)) || null,
              weight: (l.options && l.options.weight) || null,
              segments: segments
            });
          } else if (l && typeof l.getLatLng==='function'){
            var p = l.getLatLng();
            if (p && typeof p.lat==='number' && typeof p.lng==='number'){
              out.points.push([p.lng, p.lat]);
            }
          }
        }catch(e){}
      });
      return out;
    })();
    """
    return driver.execute_script(js)

def meta_from_html(html, url):
    soup = BeautifulSoup(html, "html.parser")
    title = soup.select_one(SEL_ROUTE_TITLE)
    city  = soup.select_one(SEL_CITY_LABEL)
    # id desde canonical
    rid = None
    link = soup.find("link", rel="canonical")
    if link and link.get("href"):
        q = parse_qs(urlparse(link["href"]).query)
        rid = q.get("routes", [None])[0]
    return {
        "route_id": rid,
        "title": title.get_text(" ", strip=True) if title else None,
        "city": city.get_text(" ", strip=True) if city else None,
        "url": url
    }

def save_geojson_lines(out_dir: Path, lines):
    feats = []
    for i, Lobj in enumerate(lines, 1):
      # cada elemento tiene una lista de segmentos ya en [lon,lat]
      for seg in Lobj.get("segments", []):
        if not seg or len(seg) < 2: continue
        feats.append({
          "type":"Feature",
          "geometry":{"type":"LineString","coordinates":seg},
          "properties":{"color": Lobj.get("color"), "weight": Lobj.get("weight"), "idx": i}
        })
    fc = {"type":"FeatureCollection","features":feats}
    (out_dir/"route_track.geojson").write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")

def save_geojson_points(out_dir: Path, pts):
    feats = [{"type":"Feature","geometry":{"type":"Point","coordinates":c},"properties":{}} for c in pts]
    fc = {"type":"FeatureCollection","features":feats}
    (out_dir/"stops_from_map.geojson").write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")

def scrape_route(url: str, out_root: Path, headless=True) -> Path:
    base = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    if not robots_allows(base, urlparse(url).path):
        raise RuntimeError("Robots.txt no permite scrapear esta ruta")

    d = make_driver(headless=headless)
    try:
        d.get(url)
        wait_map_ready(d)

        html = d.page_source
        meta = meta_from_html(html, url)
        rid = meta.get("route_id") or re.sub(r"[^A-Za-z0-9_-]+","_", meta.get("title") or "ruta")

        out_dir = out_root / f"route_{rid}"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir/"route.html").write_text(html, encoding="utf-8", errors="ignore")
        (out_dir/"route.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        # toma las capas de Leaflet exactamente como se ven
        layers = grab_leaflet_layers(d)

        save_geojson_lines(out_dir, layers.get("lines", []))
        if layers.get("points"):
            save_geojson_points(out_dir, layers["points"])

        # resumen simple
        summary = {
            "route_folder": str(out_dir),
            "line_segments": sum(len(x.get("segments", [])) for x in layers.get("lines", [])),
            "points": len(layers.get("points", []))
        }
        (out_dir/"summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return out_dir
    finally:
        d.quit()

# CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="Leaflet grabber para rutas de WikiRoutes")
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", default="data_wikiroutes")
    ap.add_argument("--headless", type=int, default=0)
    args = ap.parse_args(argv)

    out_root = Path(args.out); out_root.mkdir(parents=True, exist_ok=True)
    scrape_route(args.url, out_root, headless=bool(args.headless))

if __name__ == "__main__":
    import sys
    main(sys.argv[1:])
