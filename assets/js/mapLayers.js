// mapLayers.js
import { state, getDirFor } from './config.js';
import { $$, uniqueOrder } from './utils.js';

const LIMA_BOUNDS = L.latLngBounds(
  L.latLng(-12.55, -77.25),
  L.latLng(-11.70, -76.70)
);

// Caja "grande" aproximada al cuadro rojo de tu captura
const MAX_BOUNDS = L.latLngBounds(
  L.latLng(-12.58, -77.55), // sur, algo más a la izquierda
  L.latLng(-11.65, -76.50)  // norte, algo más a la derecha
);

// Switch para mostrar/ocultar el rectángulo de debug
const SHOW_BOUNDS_RECT = false;
let maxBoundsRect = null;

export function initMap(){
  const map = L.map('map', { minZoom:10, maxZoom:19, zoomControl:false });

  const light = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap & CARTO' }
  ).addTo(map);

  const dark = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap & CARTO' }
  );

  // Encadre inicial sobre Lima
  map.fitBounds(LIMA_BOUNDS);

  // Límites de arrastre aproximados al cuadro rojo
  map.setMaxBounds(MAX_BOUNDS);

  // Placeholder opcional para ver la caja en el mapa
  if (SHOW_BOUNDS_RECT) {
    maxBoundsRect = L.rectangle(MAX_BOUNDS, {
      color: '#22c55e',
      weight: 1,
      fill: false,
      dashArray: '4 4'
    }).addTo(map);
  }

  L.control.zoom({ position:'bottomright' }).addTo(map);

  state.map = map;
  state.baseLayers.light = light;
  state.baseLayers.dark  = dark;
}

function getStopLatLng(sys, id){
  const s = sys.stops.get(id);
  if (!s) return null;
  return [s.lat, s.lon];
}

function ensureGroups(sys, id){
  if (!sys.lineLayers.has(id)) sys.lineLayers.set(id, L.layerGroup().addTo(state.map));
  if (!sys.stopLayers.has(id)) sys.stopLayers.set(id, L.layerGroup().addTo(state.map));
}

function clearServiceLayers(sys, id){
  const g1 = sys.lineLayers.get(id);
  const g2 = sys.stopLayers.get(id);
  if (g1) g1.clearLayers();
  if (g2) g2.clearLayers();
}

export function fitTo(bounds){
  if (!bounds) return;
  const leftPad = document.getElementById('sidebar')?.offsetWidth ?? 380;
  state.map.fitBounds(bounds, {
    paddingTopLeft: [leftPad + 20, 40],
    paddingBottomRight: [30, 40]
  });
}

/* ===========================
   Macrorutas Metropolitano A/B
   =========================== */

function getMetMacroId(svc){
  const id   = String(svc.id).toUpperCase();
  const name = (svc.name || '').toUpperCase();

  // Regulares: A y C van por macroruta A
  if (id === 'A' || id === 'C') return 'A';

  // Expresos: todos por B salvo el 10 por A
  if (svc.kind === 'expreso') {
    if (id === '10' || name.includes(' 10') || name.startsWith('10 ') || name.endsWith(' 10')) {
      return 'A';
    }
    return 'B';
  }

  // Resto de regulares al troncal B por defecto
  return 'B';
}

/**
 * Dibuja la macroruta para un servicio del Metropolitano.
 * Usa:
 *   macros[macroId].north_south → norte → sur
 *   macros[macroId].south_north → sur → norte
 *
 * routeDir = 'ambas' | 'norte' | 'sur' (por ruta)
 * state.dir = 'ambas' | 'ns' | 'sn' (filtro global)
 */
function drawMetMacro(svc, routeDir, gLine, color, boundsIn){
  const macros = (state.systems.met && state.systems.met.macros) || {};
  const macroId = getMetMacroId(svc);
  const def = macros[macroId];
  if (!def) return boundsIn;

  let bounds = boundsIn;

  const drawSegmentsDir = (segments) => {
    (segments || []).forEach(seg => {
      if (!Array.isArray(seg) || seg.length < 2) return;
      const poly = L.polyline(seg, { color, weight: 4, opacity: 0.95 }).addTo(gLine);
      const b = poly.getBounds();
      bounds = bounds ? bounds.extend(b) : b;
    });
  };

  if (routeDir === 'ambas'){
    if (state.dir === 'ambas' || state.dir === 'ns') {
      // norte → sur
      drawSegmentsDir(def.north_south);
    }
    if (state.dir === 'ambas' || state.dir === 'sn') {
      // sur → norte
      drawSegmentsDir(def.south_north);
    }
  } else if (routeDir === 'norte') {
    // buses que van hacia el norte: sur → norte
    drawSegmentsDir(def.south_north);
  } else if (routeDir === 'sur') {
    // buses que van hacia el sur: norte → sur
    drawSegmentsDir(def.north_south);
  }

  return bounds;
}

/* ===========================
   Render de servicios
   =========================== */

export function renderService(systemId, id, opts={}){
  const { silentFit=false } = opts;
  const sys = state.systems[systemId];
  const svc = sys.services.find(s => String(s.id).toUpperCase() === String(id).toUpperCase());
  if (!svc) return;

  ensureGroups(sys, svc.id);
  clearServiceLayers(sys, svc.id);

  const gLine = sys.lineLayers.get(svc.id);
  const gStop = sys.stopLayers.get(svc.id);
  let bounds = null;

  const drawSegments = (segments, color) => {
    (segments||[]).forEach(seg => {
      if (!Array.isArray(seg) || seg.length < 2) return;
      const poly = L.polyline(seg, { color, weight: 4, opacity: 0.95 }).addTo(gLine);
      const b = poly.getBounds();
      bounds = bounds ? bounds.extend(b) : b;
    });
  };

  const drawByStops = (ids, color) => {
    const pts = uniqueOrder(ids.map(st => getStopLatLng(sys, st)).filter(Boolean));
    if (pts.length >= 2){
      const poly = L.polyline(pts, { color, weight: 4, opacity: 0.95 }).addTo(gLine);
      const b = poly.getBounds();
      bounds = bounds ? bounds.extend(b) : b;
    }
  };

  const routeDir = getDirFor(systemId, id);

  if (systemId === 'alim'){
    if (routeDir === 'ambas'){
      const segs = svc.geom.length
        ? svc.geom
        : [...(svc.geom_norte||[]), ...(svc.geom_sur||[])];
      drawSegments(segs, svc.color);
    } else if (routeDir === 'norte') {
      drawSegments(svc.geom_norte || svc.geom, svc.color);
    } else if (routeDir === 'sur') {
      drawSegments(svc.geom_sur   || svc.geom, svc.color);
    }

  } else if (systemId === 'met') {
    // Intentar primero con macroruta A/B
    const prevBounds = bounds;
    bounds = drawMetMacro(svc, routeDir, gLine, svc.color, bounds);

    // Si no hay macro (o no dibujó nada), fallback al comportamiento previo
    if (bounds === prevBounds) {
      if (svc.kind === 'regular'){
        // Antes los regulares iban por stops
        drawByStops(svc.stops || [], svc.color);
      } else {
        // Expresos / especiales por north_south / south_north
        if (routeDir === 'ambas'){
          if (state.dir === 'ambas' || state.dir === 'ns') {
            drawByStops(svc.north_south || [], svc.color);
          }
          if (state.dir === 'ambas' || state.dir === 'sn') {
            drawByStops(svc.south_north || [], svc.color);
          }
        } else if (routeDir === 'norte'){
          // Norte = sentido Sur → Norte
          drawByStops(svc.south_north || [], svc.color);
        } else if (routeDir === 'sur'){
          // Sur   = sentido Norte → Sur
          drawByStops(svc.north_south || [], svc.color);
        }
      }
    }

  } else if (systemId === 'corr'){
    if (svc.segments?.length) drawSegments(svc.segments, svc.color);
    else if (svc.stops?.length) drawByStops(svc.stops, svc.color);

  } else if (systemId === 'metro'){
    drawSegments(svc.segments || [], svc.color);
  }

  // Paraderos
  let stopsToUse = [];

  if (Array.isArray(svc.stops) && svc.stops.length){
    // Caso general: servicios con lista de paraderos
    stopsToUse = svc.stops;
  } else if (systemId === 'met') {
    // Metropolitano expresos: usar north_south / south_north según dir
    const ns = Array.isArray(svc.north_south) ? svc.north_south : [];
    const sn = Array.isArray(svc.south_north) ? svc.south_north : [];

    if (routeDir === 'ambas'){
      if (state.dir === 'ambas'){
        stopsToUse = [...ns, ...sn];
      } else if (state.dir === 'ns'){
        stopsToUse = ns;
      } else if (state.dir === 'sn'){
        stopsToUse = sn;
      }
    } else if (routeDir === 'norte'){
      // Norte = Sur → Norte
      stopsToUse = sn;
    } else if (routeDir === 'sur'){
      // Sur = Norte → Sur
      stopsToUse = ns;
    }
  }

  if (state.showStops && Array.isArray(stopsToUse) && stopsToUse.length){
    const used = new Set();
    stopsToUse.forEach(st => {
      if (used.has(st)) return;
      used.add(st);
      const ll = getStopLatLng(sys, st);
      if (!ll) return;
      const marker = L.marker(ll, {
        icon: L.divIcon({ className:'stop-pin', iconSize:[16,16] })
      }).addTo(gStop);
      const nm = sys.stops.get(st)?.name || st;
      marker.bindTooltip(nm, { permanent:false, direction:'top' });
    });
  }

  if (state.autoFit && bounds && !silentFit) fitTo(bounds.pad(0.04));
}

export function hideService(systemId, id){
  const sys = state.systems[systemId];
  const g1 = sys.lineLayers.get(id);
  const g2 = sys.stopLayers.get(id);
  if (g1) g1.clearLayers();
  if (g2) g2.clearLayers();
}

export function onToggleService(systemId, id, checked, opts={}){
  if (checked) renderService(systemId, id, opts);
  else hideService(systemId, id);
}

// Wikiroutes
export function setWikiroutesVisible(id, visible, { fit=false } = {}){
  const wr = state.systems.wr;
  const g = wr.layers.get(id);
  if (!g) return;
  if (visible) {
    g.addTo(state.map);
    if (fit && wr.bounds.get(id) && state.autoFit) fitTo(wr.bounds.get(id).pad(0.04));
  } else {
    state.map.removeLayer(g);
  }
}

export function reRenderVisibleSystem(sysId){
  const sel =
    sysId==='met'   ? '#p-met-reg .item input[type=checkbox], #p-met-exp .item input[type=checkbox]' :
    sysId==='alim'  ? '#p-met-alim .item input[type=checkbox]' :
    sysId==='corr'  ? '#p-corr .item input[type=checkbox]' :
    sysId==='wr'    ? '#p-wr .item input[type=checkbox]' :
    '#p-metro .item input[type=checkbox]';

  $$(sel).forEach(chk=>{
    if (sysId==='wr'){
      if (chk.checked) setWikiroutesVisible(chk.dataset.id, true, {fit:true});
      else setWikiroutesVisible(chk.dataset.id, false);
    } else {
      if (chk.checked) onToggleService(sysId, chk.dataset.id, true, {silentFit:true});
      else hideService(sysId, chk.dataset.id);
    }
  });
}

export function reRenderVisible(){
  ['met','alim','corr','metro','wr'].forEach(reRenderVisibleSystem);
}

export function setBase(theme){
  if (theme === state.currentBase) return;
  state.map.removeLayer(state.baseLayers[state.currentBase]);
  state.map.addLayer(state.baseLayers[theme]);
  state.currentBase = theme;
}
