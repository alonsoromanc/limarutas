// parsers.js
import { asLatLng, fetchJSON } from './utils.js';
import { COLOR_AN, COLOR_AS, state } from './config.js';

// Catálogo (filter only/exclude)
export function filterByCatalogFor(systemId, services, catalog){
  const upper = s => String(s).toUpperCase();
  const S = services;

  if (systemId === 'met') {
    const reg  = catalog?.metropolitano?.regulares || {};
    const exp  = catalog?.metropolitano?.expresos  || {};
    const onlyReg = Array.isArray(reg.only) ? new Set(reg.only.map(upper)) : null;
    const excReg  = Array.isArray(reg.exclude) ? new Set(reg.exclude.map(upper)) : new Set();
    const onlyExp = Array.isArray(exp.only) ? new Set(exp.only.map(upper)) : null;
    const excExp  = Array.isArray(exp.exclude) ? new Set(exp.exclude.map(upper)) : new Set();

    return S.filter(s => {
      const idU = upper(s.id);
      if (s.kind === 'regular') {
        if (excReg.has(idU)) return false;
        if (onlyReg) return onlyReg.has(idU);
        return true;
      }
      if (excExp.has(idU)) return false;
      if (onlyExp) return onlyExp.has(idU);
      return true;
    });
  }

  if (systemId === 'alim') {
    const al = catalog?.metropolitano?.alimentadores || {};
    const only = Array.isArray(al.only) ? new Set(al.only.map(upper)) : null;
    const exc  = Array.isArray(al.exclude) ? new Set(al.exclude.map(upper)) : new Set();
    return S.filter(s => {
      const idU = upper(s.id);
      if (exc.has(idU)) return false;
      if (only) return only.has(idU);
      return true;
    });
  }

  if (systemId === 'corr') {
    const corr = catalog?.corredores || {};
    const only = Array.isArray(corr.only) ? new Set(corr.only.map(upper)) : null;
    const exc  = Array.isArray(corr.exclude) ? new Set(corr.exclude.map(upper)) : new Set();
    return S.filter(s => {
      const idU = upper(s.id);
      if (exc.has(idU)) return false;
      if (only) return only.has(idU);
      return true;
    });
  }

  if (systemId === 'metro') {
    const m = catalog?.metro || {};
    const only = Array.isArray(m.only) ? new Set(m.only.map(upper)) : null;
    const exc  = Array.isArray(m.exclude) ? new Set(m.exclude.map(upper)) : new Set();
    return S.filter(s => {
      const idU = upper(s.id);
      if (exc.has(idU)) return false;
      if (only) return only.has(idU);
      return true;
    });
  }

  return S;
}

// Alimentadores
export const toSegments = (g) => {
  if (!g) return [];
  if (g.type === 'LineString')      return [g.coordinates.map(asLatLng)];
  if (g.type === 'MultiLineString') return g.coordinates.map(seg => seg.map(asLatLng));
  return [];
};

export function dirFromProps(p){
  const raw = (p.dir || p.direction || p.oneway || p.sentido || '').toString().toLowerCase();
  if (!raw) return null;
  if (/(^|[^a-z])n(orte)?($|[^a-z])/.test(raw) && !/(^|[^a-z])s(ur)?($|[^a-z])/.test(raw)) return 'norte';
  if (/(^|[^a-z])s(ur)?($|[^a-z])/.test(raw) && !/(^|[^a-z])n(orte)?($|[^a-z])/.test(raw)) return 'sur';
  return null;
}

export function classifySegmentsByNS(segments){
  const norte = [], sur = [], flat = [];
  segments.forEach(seg => {
    if (!Array.isArray(seg) || seg.length < 2) return;
    const a = seg[0], b = seg[seg.length-1];
    const dLat = b[0] - a[0];
    if (Math.abs(dLat) < 0.0005) flat.push(seg);
    else if (dLat > 0) norte.push(seg);
    else sur.push(seg);
  });
  return { norte, sur, flat };
}

export function buildAlimFromFC(json){
  const routes = new Map();
  const stops  = new Map();

  const ensure = (ref, props={}) => {
    if (!routes.has(ref)){
      const isN = String(ref).toUpperCase().startsWith('AN');
      routes.set(ref, {
        id: String(ref).toUpperCase(),
        name: props.name || props.label || '',
        zone: isN ? 'NORTE' : 'SUR',
        color: props.stroke || (isN ? COLOR_AN : COLOR_AS),
        geom: [],
        geom_norte: [],
        geom_sur: [],
        stops: []
      });
    } else {
      const s = routes.get(ref);
      if (!s.color && props.stroke) s.color = props.stroke;
      if (!s.name && (props.name || props.label)) s.name = props.name || props.label;
    }
    return routes.get(ref);
  };

  for (const f of (json?.features||[])){
    const g = f.geometry || {};
    const p = f.properties || {};
    const ref = p.ref_norm || p.ref || p.code || p.id;
    if (!ref) continue;

    if (g.type === 'LineString' || g.type === 'MultiLineString'){
      const svc = ensure(ref, p);
      const segs = toSegments(g);
      const dd = dirFromProps(p);
      if (dd === 'norte')      (svc.geom_norte = svc.geom_norte || []).push(...segs);
      else if (dd === 'sur')   (svc.geom_sur   = svc.geom_sur   || []).push(...segs);
      else                     svc.geom.push(...segs);
    }

    if (g.type === 'Point'){
      const [lat,lon] = asLatLng(g.coordinates || []);
      const svc = ensure(ref, p);
      const id = `alim:${ref}:${svc.stops.length}`;
      stops.set(id, { id, name: p.name || p.label || 'Paradero', lat, lon });
      svc.stops.push(id);
    }
  }

  for (const svc of routes.values()){
    if ((svc.geom_norte?.length||0)===0 && (svc.geom_sur?.length||0)===0 && (svc.geom?.length||0)>0){
      const {norte, sur, flat} = classifySegmentsByNS(svc.geom);
      svc.geom_norte = [...norte, ...flat];
      svc.geom_sur   = [...sur,   ...flat];
    }
  }

  return { services: Array.from(routes.values()), stops };
}

// Corredores
export function buildCorredoresFromFC(json){
  const routes = new Map();     // id -> {id,name,color,segments:[],stops:[]}
  const stops  = new Map();     // stopId -> {id,name,lat,lon}
  let noRef = 0;

  const ensure = (ref, props={}) => {
    const id = String(ref).toUpperCase();
    if (!routes.has(id)){
      routes.set(id, {
        id,
        name: props.name || props.label || '',
        color: props.stroke || props.color || '#10b981',
        segments: [],
        stops: []
      });
    } else {
      const s = routes.get(id);
      if (!s.color && (props.stroke || props.color)) s.color = props.stroke || props.color;
      if (!s.name && (props.name || props.label))    s.name  = props.name || props.label;
    }
    return routes.get(id);
  };

  for (const f of (json?.features || [])){
    const g = f.geometry || {};
    const p = f.properties || {};
    const ref = p.ref || p.route || p.id || p.code || p.codigo;
    if (!ref){ noRef++; continue; }

    const svc = ensure(ref, p);

    if (g.type === 'LineString' || g.type === 'MultiLineString'){
      const segs = toSegments(g);
      segs.forEach(seg => svc.segments.push(seg));
    }

    if (g.type === 'Point'){
      const [lat, lon] = asLatLng(g.coordinates || []);
      if (Number.isFinite(lat) && Number.isFinite(lon)){
        const sid = `corr:${String(ref).toUpperCase()}:${svc.stops.length}`;
        stops.set(sid, { id:sid, name: p.name || p.label || 'Paradero', lat, lon });
        svc.stops.push(sid);
      }
    }
  }

  return { services: [...routes.values()], stops, noRef };
}

// Metro
export function buildMetroFromJSON(json){
  const lines = [];
  const stops = new Map();

  const pushStop = (lineId, st, idx) => {
    const id = `metro:${lineId}:${idx}`;
    stops.set(id, {
      id,
      name: st.name || st.label || `Estación ${idx + 1}`,
      lat: st.lat,
      lon: st.lon
    });
    return id;
  };

  const pushLine = (LID, name, color, segments, stationObjs = []) => {
    const id = String(LID).toUpperCase();
    const svc = {
      id,
      name: name || `Línea ${id}`,
      color: color || '#0ea5e9',
      segments: [],
      stops: []
    };

    // Geometría de la vía (si viene en el JSON)
    (segments || []).forEach(seg => {
      if (!seg) return;
      if (Array.isArray(seg[0]) && typeof seg[0][0] === 'number') {
        const latlngSeg = seg.map(asLatLng);
        svc.segments.push(latlngSeg);
      }
    });

    // Estaciones
    (stationObjs || []).forEach((st, i) => {
      if (typeof st?.lat === 'number' && typeof st?.lon === 'number') {
        svc.stops.push(pushStop(id, st, i));
      }
    });

    lines.push(svc);
  };

  if (json?.type === 'FeatureCollection') {
    const byId = new Map();

    for (const f of (json.features || [])) {
      const g = f.geometry || {};
      const p = f.properties || {};
      const ref = (p.ref || p.line || p.id || p.codigo || p.code || '')
        .toString()
        .toUpperCase();
      if (!ref) continue;

      if (!byId.has(ref)) {
        byId.set(ref, {
          name: p.name || p.label || `Línea ${ref}`,
          color: p.stroke || p.color || '#0ea5e9',
          segments: [],
          stations: []
        });
      }

      const acc = byId.get(ref);

      if (g.type === 'LineString' || g.type === 'MultiLineString') {
        toSegments(g).forEach(seg => acc.segments.push(seg));
      } else if (g.type === 'Point') {
        const [lat, lon] = asLatLng(g.coordinates || []);
        acc.stations.push({ name: p.name || p.label, lat, lon });
      }
    }

    for (const [id, v] of byId.entries()) {
      pushLine(id, v.name, v.color, v.segments, v.stations);
    }

  } else if (Array.isArray(json?.lines)) {
    // Formato tipo { lines: [ { id, name, color, track, stations } ] }
    for (const L of json.lines) {
      const segs = Array.isArray(L.track?.[0]?.[0])
        ? L.track
        : (Array.isArray(L.track) ? [L.track] : []);
      pushLine(L.id, L.name, L.color, segs, L.stations);
    }
  }

  // Fallback: si una línea no tiene segments, dibujarla uniendo estaciones en orden
  for (const svc of lines) {
    if (!Array.isArray(svc.segments) || svc.segments.length === 0) {
      const pts = (svc.stops || [])
        .map(id => stops.get(id))
        .filter(st => st && Number.isFinite(st.lat) && Number.isFinite(st.lon))
        .map(st => [st.lat, st.lon]);

      if (pts.length >= 2) {
        svc.segments.push(pts);
      }
    }
  }

  return { services: lines, stops };
}


// Wikiroutes helpers
function inspectFirstCoord(geojson) {
  let c = null;
  const walk = (g) => {
    if (!g) return;
    if (g.type === 'Point') c = g.coordinates;
    else if (g.type === 'LineString') c = g.coordinates[0];
    else if (g.type === 'MultiLineString') c = g.coordinates[0]?.[0];
    else if (g.type === 'Feature') walk(g.geometry);
    else if (g.type === 'FeatureCollection') walk(g.features[0]?.geometry);
  };
  walk(geojson);
  return Array.isArray(c) && c.length >= 2 ? c : null;
}

function swapXY(g) {
  const clone = JSON.parse(JSON.stringify(g));
  const swapArray = (arr) => {
    for (let i=0;i<arr.length;i++){
      const v = arr[i];
      if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number'){
        arr[i] = [v[1], v[0]];
      } else if (Array.isArray(v)) swapArray(v);
    }
  };
  if (clone.type === 'FeatureCollection') swapArray(clone.features);
  else if (clone.type === 'Feature') swapArray([clone.geometry]);
  else swapArray([clone]);
  return clone;
}

function fixIfLatLon(geojson) {
  const c = inspectFirstCoord(geojson);
  if (!c) return geojson;
  // Para Lima: |lon| ~ 77, |lat| ~ 12. Si primer numero es mas chico, probablemente viene lat,lon.
  if (Math.abs(c[0]) < Math.abs(c[1])) {
    return swapXY(geojson);
  }
  return geojson;
}

// Capa Wikiroutes
export async function buildWikiroutesLayer(id, folderPath, opts = {}) {
  const color = opts.color || '#00008C';

  const [lineRaw, ptsRaw] = await Promise.all([
    fetchJSON(`${folderPath}/line_approx.geojson`).catch(()=>null),
    fetchJSON(`${folderPath}/stops.geojson`).catch(()=>null)
  ]);

  if (!lineRaw && !ptsRaw) throw new Error('No se encontraron archivos line_approx.geojson ni stops.geojson');

  // Corrige XY si fuera necesario
  const line = lineRaw ? fixIfLatLon(lineRaw) : null;
  const pts  = ptsRaw  ? fixIfLatLon(ptsRaw)  : null;

  const group = L.layerGroup();  // no se añade aún
  let bounds = null;

  if (line) {
    const lineLyr = L.geoJSON(line, { style: () => ({ color, weight:4, opacity:0.95 }) });
    lineLyr.addTo(group);
    try { bounds = lineLyr.getBounds(); } catch {}
  }

  if (pts) {
    const stopLyr = L.geoJSON(pts, {
      pointToLayer: (_, latlng) => L.circleMarker(latlng, { radius:3, weight:1 }),
      onEachFeature: (f, layer) => {
        const q = f.properties || {};
        const label = `${q.sequence ?? ''} ${q.stop_name ?? ''}`.trim();
        if (label) layer.bindTooltip(label);
      }
    });
    stopLyr.addTo(group);
    try { bounds = bounds ? bounds.extend(stopLyr.getBounds()) : stopLyr.getBounds(); } catch {}
  }

  state.systems.wr.layers.set(id, group);
  if (bounds) state.systems.wr.bounds.set(id, bounds);
}
