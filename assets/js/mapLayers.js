// mapLayers.js
import { state, getDirFor } from './config.js';
import { $$, uniqueOrder } from './utils.js';

const MIN_ZOOM = 10;
const MAX_ZOOM = 19;

const LIMA_BOUNDS = L.latLngBounds(
  L.latLng(-12.55, -77.25),
  L.latLng(-11.70, -76.70)
);

// Caja amplia para limitar el arrastre
const MAX_BOUNDS = L.latLngBounds(
  L.latLng(-12.58, -77.55),
  L.latLng(-11.65, -76.50)
);

// Mostrar rectángulo de debug si lo necesitas
const SHOW_BOUNDS_RECT = false;
let maxBoundsRect = null;

export function initMap(){
  const map = L.map('map', {
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomControl: false
  });

  const light = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap & CARTO', maxZoom: MAX_ZOOM }
  ).addTo(map);

  const dark = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap & CARTO', maxZoom: MAX_ZOOM }
  );

  map.fitBounds(LIMA_BOUNDS);
  map.setMaxBounds(MAX_BOUNDS);

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

// A y C siguen macro A; expresos macro B salvo el 10. Regulares: macro B.
function getMetMacroId(svc){
  const id   = String(svc.id).toUpperCase();
  const name = (svc.name || '').toUpperCase();

  if (id === 'A' || id === 'C') return 'A';

  if (svc.kind === 'expreso' || svc.kind === 'expreso corto' || svc.kind === 'expreso largo') {
    if (id === '10' || name.includes(' 10') || name.startsWith('10 ') || name.endsWith(' 10')) {
      return 'A';
    }
    return 'B';
  }

  return 'B';
}

// dirKey: 'sur' (norte→sur) o 'norte' (sur→norte)
function getMetStopsForDir(svc, dirKey){
  const kind = svc.kind;

  if (kind === 'expreso' || kind === 'expreso corto' || kind === 'expreso largo') {
    const ns = Array.isArray(svc.north_south) ? svc.north_south : [];
    const sn = Array.isArray(svc.south_north) ? svc.south_north : [];

    if (dirKey === 'sur')   return ns;
    if (dirKey === 'norte') return sn;
    return ns.concat(sn);
  }

  if (Array.isArray(svc.stops) && svc.stops.length) return svc.stops;

  return [];
}

// Recorta la macrorruta al tramo entre primer y último paradero del servicio
function cutMacroSegmentsToStops(segments, svc, dirKey){
  if (!segments || !segments.length) return segments;

  const sysMet = state.systems.met;
  const stopIds = getMetStopsForDir(svc, dirKey);
  if (!stopIds || stopIds.length === 0) return segments;

  const stopsMap = sysMet.stops;
  const startStop = stopsMap.get(stopIds[0]);
  const endStop   = stopsMap.get(stopIds[stopIds.length - 1]);
  if (!startStop || !endStop) return segments;

  const start = [startStop.lat, startStop.lon];
  const end   = [endStop.lat,   endStop.lon];

  const flat = [];
  for (let s = 0; s < segments.length; s++){
    const seg = segments[s];
    for (let i = 0; i < seg.length; i++){
      flat.push(seg[i]);
    }
  }
  if (flat.length < 2) return segments;

  const dist2 = (a, b) => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx*dx + dy*dy;
  };

  let iStart = 0, dStart = Infinity;
  let iEnd   = 0, dEnd   = Infinity;

  for (let i = 0; i < flat.length; i++){
    const p = flat[i];
    const ds = dist2(p, start);
    if (ds < dStart){ dStart = ds; iStart = i; }
    const de = dist2(p, end);
    if (de < dEnd){ dEnd = de; iEnd = i; }
  }

  if (iStart > iEnd) { const t = iStart; iStart = iEnd; iEnd = t; }

  const slice = flat.slice(iStart, iEnd + 1);
  if (slice.length < 2) return segments;

  return [slice];
}

/**
 * Dibuja la macrorruta recortada a paraderos del servicio.
 */
function drawMetMacro(svc, routeDir, gLine, color, boundsIn){
  const macros = (state.systems.met && state.systems.met.macros) || {};
  const macroId = getMetMacroId(svc);
  const def = macros[macroId];
  if (!def) return boundsIn;

  let bounds = boundsIn;

  const drawSegmentsDir = (segments) => {
    if (!segments) return;
    (segments || []).forEach(seg => {
      if (!Array.isArray(seg) || seg.length < 2) return;
      const poly = L.polyline(seg, { color, weight: 4, opacity: 0.95 }).addTo(gLine);
      const b = poly.getBounds();
      bounds = bounds ? bounds.extend(b) : b;
    });
  };

  if (routeDir === 'ambas'){
    if (state.dir === 'ambas' || state.dir === 'ns') {
      const baseNS = def.north_south || [];
      const segNS  = cutMacroSegmentsToStops(baseNS, svc, 'sur');
      drawSegmentsDir(segNS);
    }
    if (state.dir === 'ambas' || state.dir === 'sn') {
      const baseSN = def.south_north || [];
      const segSN  = cutMacroSegmentsToStops(baseSN, svc, 'norte');
      drawSegmentsDir(segSN);
    }
  } else if (routeDir === 'norte') {
    const baseSN = def.south_north || [];
    const segSN  = cutMacroSegmentsToStops(baseSN, svc, 'norte');
    drawSegmentsDir(segSN);
  } else if (routeDir === 'sur') {
    const baseNS = def.north_south || [];
    const segNS  = cutMacroSegmentsToStops(baseNS, svc, 'sur');
    drawSegmentsDir(segNS);
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
    const prevBounds = bounds;
    bounds = drawMetMacro(svc, routeDir, gLine, svc.color, bounds);
    if (bounds === prevBounds) {
      if (svc.kind === 'regular'){
        drawByStops(svc.stops || [], svc.color);
      } else {
        if (routeDir === 'ambas'){
          if (state.dir === 'ambas' || state.dir === 'ns') drawByStops(svc.north_south || [], svc.color);
          if (state.dir === 'ambas' || state.dir === 'sn') drawByStops(svc.south_north || [], svc.color);
        } else if (routeDir === 'norte'){
          drawByStops(svc.south_north || [], svc.color);
        } else if (routeDir === 'sur'){
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
    stopsToUse = svc.stops;
  } else if (systemId === 'met') {
    const ns = Array.isArray(svc.north_south) ? svc.north_south : [];
    const sn = Array.isArray(svc.south_north) ? svc.south_north : [];

    if (routeDir === 'ambas'){
      if (state.dir === 'ambas')      stopsToUse = ns.concat(sn);
      else if (state.dir === 'ns')    stopsToUse = ns;
      else if (state.dir === 'sn')    stopsToUse = sn;
    } else if (routeDir === 'norte'){
      stopsToUse = sn;
    } else if (routeDir === 'sur'){
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
      const marker = L.marker(ll, { icon: L.divIcon({ className:'stop-pin', iconSize:[16,16] }) }).addTo(gStop);
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

/* ===========================
   Wikiroutes con viajes
   =========================== */

// Paradas WR on/off según visibilidad de cada subcapa
function syncOneWrStopsVisibility(id){
  const wr = state.systems.wr;
  const g = wr.layers?.get(id);
  const stopSub = wr.stopLayers?.get(id);
  if (!stopSub) return;

  const routeVisible = g && state.map.hasLayer(g);
  if (routeVisible && state.showStops) {
    if (!state.map.hasLayer(stopSub)) stopSub.addTo(state.map);
  } else {
    if (state.map.hasLayer(stopSub)) state.map.removeLayer(stopSub);
  }
}

// Leer mapeo ida/vuelta desde el DOM
function getWrPairFromDOM(parentId){
  const leaf = document.querySelector(`#p-wr .item input[type="checkbox"][data-id="${parentId}"]`);
  if (!leaf) return null;
  return {
    ida: leaf.dataset.ida || null,
    vuelta: leaf.dataset.vuelta || null,
    sel: leaf.dataset.sel || 'ida',
    leaf
  };
}

// Mostrar/ocultar una subcapa WR por id real
function toggleWrSub(id, visible, fit){
  const wr = state.systems.wr;
  const g = wr.layers?.get(id);
  if (!g) return;

  if (visible) {
    g.addTo(state.map);
    syncOneWrStopsVisibility(id);
    if (fit && wr.bounds?.get(id) && state.autoFit) fitTo(wr.bounds.get(id).pad(0.04));
  } else {
    state.map.removeLayer(g);
    const stopSub = wr.stopLayers?.get(id);
    if (stopSub && state.map.hasLayer(stopSub)) state.map.removeLayer(stopSub);
  }
}

// API pública: acepta id real (subcapa) o id padre
export function setWikiroutesVisible(id, visible, { fit=false } = {}){
  const wr = state.systems.wr;

  // Si es subcapa real, actúa directo
  if (wr.layers?.has(id)) {
    toggleWrSub(id, visible, fit);
    return;
  }

  // Si es padre, delega al handler de hoja usando el DOM
  const pair = getWrPairFromDOM(id);
  if (pair) {
    setWikiroutesVisibleLeaf(id, visible, { fit });
  }
}

// Mostrar/ocultar el viaje seleccionado de un padre
export function setWikiroutesVisibleLeaf(parentId, checked, { fit=false } = {}){
  const pair = getWrPairFromDOM(parentId);

  if (!pair) {
    // No es par, interpretar como capa simple con ese id
    toggleWrSub(parentId, checked, fit);
    return;
  }

  const showId  = pair.sel === 'vuelta' ? pair.vuelta : pair.ida;
  const otherId = pair.sel === 'vuelta' ? pair.ida   : pair.vuelta;

  if (checked) {
    if (otherId) toggleWrSub(otherId, false, false);
    if (showId)  toggleWrSub(showId,  true,  fit);
  } else {
    if (showId)  toggleWrSub(showId,  false, false);
    if (otherId) toggleWrSub(otherId, false, false);
  }
}

// Cambiar IDA/VUELTA de un padre ya existente
export function setWikiroutesTrip(parentId, trip, { fit=false } = {}){
  const pair = getWrPairFromDOM(parentId);
  if (!pair) return;

  pair.leaf.dataset.sel = trip === 2 ? 'vuelta' : 'ida';

  // Si el padre está marcado, intercambia en el mapa
  if (pair.leaf.checked) {
    setWikiroutesVisibleLeaf(parentId, true, { fit });
  }
}

// Re-render de lo visible
export function reRenderVisibleSystem(sysId){
  const sel =
    sysId==='met'   ? '#p-met-reg .item input[type=checkbox], #p-met-exp .item input[type=checkbox]' :
    sysId==='alim'  ? '#p-met-alim .item input[type=checkbox]' :
    sysId==='corr'  ? '#p-corr .item input[type=checkbox]' :
    sysId==='wr'    ? '#p-wr .item input[type=checkbox]' :
    '#p-metro .item input[type=checkbox]';

  $$(sel).forEach(chk=>{
    if (sysId==='wr'){
      setWikiroutesVisibleLeaf(chk.dataset.id, chk.checked, { fit:true });
    } else {
      if (chk.checked) onToggleService(sysId, chk.dataset.id, true, {silentFit:true});
      else hideService(sysId, chk.dataset.id);
    }
  });

  if (sysId==='wr'){
    const wr = state.systems.wr;
    wr.layers?.forEach((_layer, id) => syncOneWrStopsVisibility(id));
  }
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
