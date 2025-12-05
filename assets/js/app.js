/* Mapa de Rutas – Metropolitano + Corredores + Alimentadores + Metro (Leaflet)
   - Alimentadores: data/metropolitano/alimentadores.json (FeatureCollection flexible)
   - Corredores: data/corredores/corredores.json (FeatureCollection o {services:[...]})
   - Metro: data/metro/metro.json (FeatureCollection o {lines:[...]})
   - Chips rectangulares para Corredores/Alimentadores/Metro; badges redondas para Metropolitano
   - Dirección por ruta (Amb/N/S) en Met/Alim; al cambiar N/S/A se auto-marca la ruta si estaba desmarcada
*/

(() => {
  // ------------------------------
  // Rutas y estado global
  // ------------------------------
  const PATHS = {
    data:  'data',
    met:   'data/metropolitano',
    corr:  'data/corredores',
    metro: 'data/metro',
    icons: {
      met:   'images/metropolitano',
      corr:  'images/corredores',
      metro: 'images/metro'
    }
  };

  const COLOR_AN = '#FF4500';  // Alimentadores Norte
  const COLOR_AS = '#FFCD00';  // Alimentadores Sur (default)

  const state = {
    map: null,
    baseLayers: { light: null, dark: null },
    currentBase: 'light',

    // Opciones
    dir: 'ambas',       // global para expresos Met (legacy)
    showStops: true,
    autoFit: true,

    // Catálogo (config)
    catalog: null,

    // Dirección por ruta (para controles mini):
    // key "system:id" -> 'ambas'|'norte'|'sur'
    routeDir: new Map(),

    systems: {
      met: {
        id: 'met',
        label: 'Metropolitano',
        stops: null,
        services: [],
        lineLayers: new Map(),
        stopLayers: new Map(),
        ui: { listReg: null, listExp: null, chkAll: null, chkReg: null, chkExp: null }
      },
      alim: {
        id: 'alim',
        label: 'Alimentadores',
        stops: new Map(),
        services: [],
        lineLayers: new Map(),
        stopLayers: new Map(),
        ui: { listN: null, listS: null, chkAll: null, chkN: null, chkS: null }
      },
      corr: {
        id: 'corr',
        label: 'Corredores',
        stops: new Map(),
        services: [],
        lineLayers: new Map(),
        stopLayers: new Map(),
        ui: { list: null, chkAll: null, groups: new Map() }
      },
      metro: {
        id: 'metro',
        label: 'Metro',
        stops: new Map(),
        services: [], // {id, name, color, segments:[[[lat,lng]...]], stops:[stopId]}
        lineLayers: new Map(),
        stopLayers: new Map(),
        ui: { list: null, chkAll: null }
      }
    },

    bulk: false,
    _searchIndex: []
  };

  // ------------------------------
  // Utils DOM
  // ------------------------------
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const el = (tag, attrs={}, ...children) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v])=>{
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k,v);
    });
    children.forEach(c => n.append(c));
    return n;
  };
  const keyFor = (systemId, id) => `${systemId}:${String(id).toUpperCase()}`;
  const getDirFor = (systemId, id) => state.routeDir.get(keyFor(systemId,id)) || 'ambas';
  const setDirFor = (systemId, id, dir) => state.routeDir.set(keyFor(systemId,id), dir);

  // ------------------------------
  // Mapa
  // ------------------------------
  function initMap(){
    const LIMA_BOUNDS = L.latLngBounds(
      L.latLng(-12.55, -77.25),
      L.latLng(-11.70, -76.70)
    );

    const map = L.map('map', {
      minZoom: 10,
      maxZoom: 19,
      zoomControl: false
    });

    const light = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { attribution: '&copy; OpenStreetMap & CARTO' }
    ).addTo(map);

    const dark = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { attribution: '&copy; OpenStreetMap & CARTO' }
    );

    map.fitBounds(LIMA_BOUNDS);
    map.setMaxBounds(LIMA_BOUNDS.pad(0.02));
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    state.map = map;
    state.baseLayers.light = light;
    state.baseLayers.dark  = dark;
  }

  // ------------------------------
  // Fetch / datos
  // ------------------------------
  async function fetchJSON(path){
    const r = await fetch(path);
    if (!r.ok) throw new Error(`HTTP ${r.status} — ${path}`);
    return r.json();
  }

  const asLatLng = (pt) => Array.isArray(pt) ? [pt[1], pt[0]] : [pt.lat, pt.lon];
  function stopsArrayToMap(stations){
    const m = new Map();
    (stations||[]).forEach(s => m.set(s.id, s));
    return m;
  }

  // ------------------------------
  // Catálogo (filter only/exclude)
  // ------------------------------
  function filterByCatalogFor(systemId, services, catalog){
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
        } else {
          if (excExp.has(idU)) return false;
          if (onlyExp) return onlyExp.has(idU);
          return true;
        }
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

  // ------------------------------
  // Alimentadores (parser flexible)
  // ------------------------------
  const toSegments = (g) => {
    if (!g) return [];
    if (g.type === 'LineString')      return [g.coordinates.map(asLatLng)];
    if (g.type === 'MultiLineString') return g.coordinates.map(seg => seg.map(asLatLng));
    return [];
  };

  function dirFromProps(p){
    const raw = (p.dir || p.direction || p.oneway || p.sentido || '').toString().toLowerCase();
    if (!raw) return null;
    if (/(^|[^a-z])n(orte)?($|[^a-z])/.test(raw) && !/(^|[^a-z])s(ur)?($|[^a-z])/.test(raw)) return 'norte';
    if (/(^|[^a-z])s(ur)?($|[^a-z])/.test(raw) && !/(^|[^a-z])n(orte)?($|[^a-z])/.test(raw)) return 'sur';
    return null;
  }

  function classifySegmentsByNS(segments){
    const norte = [], sur = [], flat = [];
    segments.forEach(seg => {
      if (!Array.isArray(seg) || seg.length < 2) return;
      const a = seg[0], b = seg[seg.length-1];
      const dLat = b[0] - a[0]; // lat aumenta hacia el norte
      if (Math.abs(dLat) < 0.0005) flat.push(seg);
      else if (dLat > 0) norte.push(seg);
      else sur.push(seg);
    });
    return { norte, sur, flat };
  }

  function buildAlimFromFC(json){
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

  // ------------------------------
  // Corredores (parser FeatureCollection)
  // ------------------------------
  function buildCorredoresFromFC(json){
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
        const segs = toSegments(g); // [lat,lng]
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

  // ------------------------------
  // Metro (parser flexible)
  // ------------------------------
  function buildMetroFromJSON(json){
    const lines = [];
    const stops = new Map();

    const pushStop = (lineId, st, idx) => {
      const id = `metro:${lineId}:${idx}`;
      stops.set(id, { id, name: st.name || st.label || `Estación ${idx+1}`, lat: st.lat, lon: st.lon });
      return id;
    };

    const pushLine = (LID, name, color, segments, stationObjs=[]) => {
      const id = String(LID).toUpperCase(); // p.ej. "L1"
      const svc = { id, name: name || `Línea ${id}`, color: color || '#0ea5e9', segments: [], stops: [] };
      (segments||[]).forEach(seg=>{
        if (!seg) return;
        if (Array.isArray(seg[0]) && typeof seg[0][0] === 'number') {
          const latlngSeg = seg.map(asLatLng); // lon,lat -> lat,lon
          svc.segments.push(latlngSeg);
        }
      });
      (stationObjs||[]).forEach((st,i)=>{
        if (typeof st?.lat === 'number' && typeof st?.lon === 'number'){
          svc.stops.push(pushStop(id, st, i));
        }
      });
      lines.push(svc);
    };

    if (json?.type === 'FeatureCollection') {
      const byId = new Map();
      for (const f of (json.features||[])){
        const g = f.geometry || {};
        const p = f.properties || {};
        const ref = (p.ref || p.line || p.id || p.codigo || p.code || '').toString().toUpperCase();
        if (!ref) continue;
        if (!byId.has(ref)) byId.set(ref, { name: p.name || p.label || `Línea ${ref}`, color: p.stroke || p.color || '#0ea5e9', segments: [], stations: [] });

        if (g.type === 'LineString' || g.type === 'MultiLineString') {
          toSegments(g).forEach(seg => byId.get(ref).segments.push(seg));
        } else if (g.type === 'Point') {
          const [lat,lon] = asLatLng(g.coordinates || []);
          byId.get(ref).stations.push({ name: p.name || p.label, lat, lon });
        }
      }
      for (const [id, v] of byId.entries()) pushLine(id, v.name, v.color, v.segments, v.stations);
    } else if (Array.isArray(json?.lines)) {
      for (const L of json.lines){
        const segs = Array.isArray(L.track?.[0]?.[0]) ? L.track : (Array.isArray(L.track) ? [L.track] : []);
        pushLine(L.id, L.name, L.color, segs, L.stations);
      }
    }

    return { services: lines, stops };
  }

  // ------------------------------
  // UI helpers (chips, items, direcciones mini)
  // ------------------------------
  const labelForSvc = (s) => (s.kind==='regular' ? 'Ruta' : (s.kind==='expreso' ? 'Expreso' : 'Servicio'));

  function miniDir(systemId, svc){
    if (systemId === 'corr' || systemId === 'metro') return el('div'); // no aplica
    const cur = getDirFor(systemId, svc.id);
    const wrap = el('div',{class:'dir-mini'});
    const mk = (val,label,title) => el('button',{class:`segbtn-mini${cur===val?' active':''}`,'data-dir':val,title},label);
    wrap.append(mk('ambas','Amb','Ambas'), mk('norte','N','Norte'), mk('sur','S','Sur'));
    wrap.addEventListener('click',(e)=>{
      const b = e.target.closest('.segbtn-mini');
      if (!b) return;
      const dir = b.dataset.dir;
      if (!dir || dir===getDirFor(systemId, svc.id)) return;
      setDirFor(systemId, svc.id, dir);
      wrap.querySelectorAll('.segbtn-mini').forEach(x=>x.classList.toggle('active', x===b));
      const chk = wrap.parentElement.querySelector('.item-head input[type="checkbox"]');
      if (chk){
        if (!chk.checked){
          // UX: si estaba desmarcado y eliges N/S/A, se marca automáticamente y se dibuja
          setLeafChecked(systemId, chk, true, {silentFit:true});
          syncTriFromLeaf(systemId);
        } else {
          onToggleService(systemId, svc.id, true, {silentFit:true});
        }
      }
    });
    return wrap;
  }

  function makeServiceItemMet(svc){
    const img = el('img',{src:`${PATHS.icons.met}/${String(svc.id).toUpperCase()}.png`, class:'badge', alt:svc.id});
    img.onerror = () => img.replaceWith(el('span',{class:'badge', style:`background:${svc.color}`}, String(svc.id)));

    const left = el('div',{class:'left'},
      img,
      el('div',{}, el('div',{class:'name'}, `${labelForSvc(svc)} ${svc.id}`), el('div',{class:'sub'}, svc.name || ''))
    );

    const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'met'});
    const head = el('div',{class:'item-head'}, left, chk);
    const body = el('div',{class:'item'}, head, miniDir('met', svc));

    chk.addEventListener('change', () => { if (!state.bulk) { onToggleService('met', svc.id, chk.checked); syncTriFromLeaf('met'); } });
    return body;
  }

  function makeServiceItemAlim(svc){
    const code = String(svc.id).toUpperCase();
    const tag = el('span',{class:'tag', style:`background:${svc.color || (code.startsWith('AN')?COLOR_AN:COLOR_AS)}`}, code);
    const left = el('div',{class:'left'},
      tag,
      el('div',{}, el('div',{class:'name'}, svc.name || `Alimentador ${code}`), el('div',{class:'sub'}, `Zona ${svc.zone==='NORTE'?'Norte':'Sur'}`))
    );
    const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'alim'});
    const head = el('div',{class:'item-head'}, left, chk);
    const body = el('div',{class:'item'}, head, miniDir('alim', svc));
    chk.addEventListener('change', () => { if (!state.bulk) { onToggleService('alim', svc.id, chk.checked); syncTriFromLeaf('alim'); } });
    return body;
  }

  function makeServiceItemCorr(svc){
    const tag = el('span',{class:'tag', style:`background:${svc.color}`}, String(svc.id));
    const left = el('div',{class:'left'},
      tag,
      el('div',{}, el('div',{class:'name'}, `Expreso ${svc.id}`), el('div',{class:'sub'}, svc.name || ''))
    );
    const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'corr'});
    const head = el('div',{class:'item-head'}, left, chk);
    const body = el('div',{class:'item'}, head); // sin mini dir
    chk.addEventListener('change', () => { if (!state.bulk) { onToggleService('corr', svc.id, chk.checked); syncTriFromLeaf('corr'); } });
    return body;
  }

  function makeServiceItemMetro(svc){
    // icono: primero "1.png", "2.png"...; fallback "L1.png"; luego chip de color
    const code = String(svc.id).toUpperCase();      // p.ej. "L1"
    const fileBaseNow = code.replace(/^L/i, '');    // "1"
    const primary = `${PATHS.icons.metro}/${fileBaseNow}.png`;
    const alt     = `${PATHS.icons.metro}/${code}.png`;

    const ico = new Image();
    ico.alt = code;
    ico.className = 'badge';
    ico.src = primary;
    ico.onerror = () => {
      if (!ico.dataset.altTried) { ico.dataset.altTried = '1'; ico.src = alt; }
      else ico.replaceWith(el('span',{class:'tag', style:`background:${svc.color}`}, code));
    };

    const left = el('div',{class:'left'},
      ico,
      el('div',{}, el('div',{class:'name'}, `Línea ${code}`), el('div',{class:'sub'}, svc.name || ''))
    );

    const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'metro'});
    const head = el('div',{class:'item-head'}, left, chk);
    const body = el('div',{class:'item'}, head); // Metro no usa mini-dir
    chk.addEventListener('change', () => { if (!state.bulk) { onToggleService('metro', svc.id, chk.checked); syncTriFromLeaf('metro'); } });
    return body;
  }

  function makeServiceItem(systemId, svc){
    if (systemId==='met')   return makeServiceItemMet(svc);
    if (systemId==='alim')  return makeServiceItemAlim(svc);
    if (systemId==='corr')  return makeServiceItemCorr(svc);
    if (systemId==='metro') return makeServiceItemMetro(svc);
    return document.createTextNode('');
  }

  // ------------------------------
  // Construcción de listas
  // ------------------------------
  function fillMetList(){
    const sys = state.systems.met;
    sys.ui.listReg.innerHTML = '';
    sys.ui.listExp.innerHTML = '';
    const reg = sys.services.filter(s => s.kind === 'regular');
    const exp = sys.services.filter(s => s.kind === 'expreso');
    reg.forEach(s => sys.ui.listReg.appendChild(makeServiceItem('met', s)));
    exp.forEach(s => sys.ui.listExp.appendChild(makeServiceItem('met', s)));
  }

  function fillAlimList(){
    const sys = state.systems.alim;
    sys.ui.listN.innerHTML = '';
    sys.ui.listS.innerHTML = '';
    sys.services.filter(s => s.zone === 'NORTE').forEach(s => sys.ui.listN.appendChild(makeServiceItem('alim', s)));
    sys.services.filter(s => s.zone === 'SUR')  .forEach(s => sys.ui.listS.appendChild(makeServiceItem('alim', s)));
  }

  // Corredores agrupados por color/nombre (heurística)
  function corridorGroupName(s){
    const nm = s.name || '';
    const m = /Corredor\s+(Azul|Morado|Rojo|Amarillo)/i.exec(nm);
    if (m) return `Corredor ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}`;
    const c = String(s.color||'').toUpperCase();
    const inAny = (arr) => arr.some(hex => hex.toUpperCase() === c);
    if (inAny(['#1565C0','#1E40AF','#0D47A1','#1D4ED8','#0A4ACF','#0074D9'])) return 'Corredor Azul';
    if (inAny(['#6A1B9A','#7E22CE','#8B5CF6','#673AB7','#7E3AF2']))          return 'Corredor Morado';
    if (inAny(['#C62828','#DC2626','#EF4444','#B91C1C','#E53E3E']))          return 'Corredor Rojo';
    if (inAny(['#F59E0B','#F9A825','#FFC107','#FBBF24']))                    return 'Corredor Amarillo';
    return 'Otros';
  }
  function keyFromGroupName(label){
    const k = label.toLowerCase();
    if (k.includes('azul')) return 'azul';
    if (k.includes('morado')) return 'morado';
    if (k.includes('rojo')) return 'rojo';
    if (k.includes('amarillo')) return 'amarillo';
    return 'otros';
  }
  function buildCorrGroupSection(container, key, label){
    const secId = `p-corr-${key}`;
    const chkId = `chk-corr-${key}`;
    const section = el('section',{class:'panel nested'});
    const head = el('button',{class:'panel-head','data-target':secId,'aria-expanded':'false'},
      el('span',{class:'chev'},'▸'),
      el('span',{class:'title'},label),
      el('input',{type:'checkbox',id:chkId,class:'right','data-group':key})
    );
    const body = el('div',{id:secId,class:'panel-body list'});
    section.append(head, body);
    container.appendChild(section);
    const chk = head.querySelector('input[type="checkbox"]');
    state.systems.corr.ui.groups.set(key,{chk,body});
    chk.addEventListener('change',()=> onLevel2ChangeCorr(chk));
  }
  function fillCorrList(){
    const sys = state.systems.corr;
    const container = sys.ui.list;
    const empty = $('#p-corr-empty');
    container.innerHTML = '';
    sys.ui.groups.clear();
    if (!sys.services.length){
      empty && (empty.style.display = 'block');
      sys.ui.chkAll && (sys.ui.chkAll.disabled = true);
      return;
    }
    empty && (empty.style.display = 'none');
    sys.ui.chkAll && (sys.ui.chkAll.disabled = false);

    const groups = new Map();
    sys.services.forEach(s => {
      const key = corridorGroupName(s);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });
    const order = ['Corredor Azul','Corredor Morado','Corredor Rojo','Corredor Amarillo','Otros'];
    const keys = [...groups.keys()].sort((a,b)=>{
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia===-1 && ib===-1) return a.localeCompare(b);
      if (ia===-1) return 1;
      if (ib===-1) return -1;
      return ia-ib;
    });
    keys.forEach(label => {
      const key = keyFromGroupName(label);
      buildCorrGroupSection(container, key, label);
      const grp = state.systems.corr.ui.groups.get(key);
      groups.get(label).forEach(svc => grp.body.appendChild(makeServiceItem('corr', svc)));
    });
  }

  // Metro (lista simple)
  function fillMetroList(){
    const sys = state.systems.metro;
    const list = sys.ui.list;
    if (!list) return;
    list.innerHTML = '';
    sys.services.forEach(s => list.appendChild(makeServiceItem('metro', s)));
  }

  // ------------------------------
  // Jerarquía / checks
  // ------------------------------
  function bulk(fn){ state.bulk = true; try { fn(); } finally { state.bulk = false; } }

  function routeCheckboxesOf(systemId, groupChk=null){
    if (systemId==='met'){
      if (groupChk === state.systems.met.ui.chkReg) return $$('#p-met-reg .item input[type=checkbox]');
      if (groupChk === state.systems.met.ui.chkExp) return $$('#p-met-exp .item input[type=checkbox]');
      return $$('#p-met-reg .item input[type=checkbox], #p-met-exp .item input[type=checkbox]');
    }
    if (systemId==='alim'){
      if (groupChk === state.systems.alim.ui.chkN) return $$('#p-met-alim-n .item input[type=checkbox]');
      if (groupChk === state.systems.alim.ui.chkS) return $$('#p-met-alim-s .item input[type=checkbox]');
      return $$('#p-met-alim .item input[type=checkbox]');
    }
    if (systemId==='corr'){
      if (groupChk && groupChk.dataset.group){
        return $(`#p-corr-${groupChk.dataset.group}`) ?
          Array.from(document.querySelectorAll(`#p-corr-${groupChk.dataset.group} .item input[type=checkbox]`)) : [];
      }
      return $$('#p-corr .item input[type=checkbox]');
    }
    if (systemId==='metro'){
      return $$('#p-metro .item input[type=checkbox]');
    }
    return [];
  }

  function setLeafChecked(systemId, leafChk, checked, {silentFit=false}={}){
    if (leafChk.checked === checked) return;
    leafChk.checked = checked;
    const id = leafChk.dataset.id;
    if (id) onToggleService(systemId, id, checked, {silentFit});
  }

  function setLevel2Checked(systemId, groupChk, checked, {silentFit=false}={}){
    groupChk && (groupChk.checked = checked);
    groupChk && (groupChk.indeterminate = false);
    const leaves = routeCheckboxesOf(systemId, groupChk);
    leaves.forEach(ch => setLeafChecked(systemId, ch, checked, {silentFit}));
  }

  // Met
  function onLevel1ChangeMet(){
    const v = state.systems.met.ui.chkAll.checked;
    bulk(()=>{
      setLevel2Checked('met',  state.systems.met.ui.chkReg, v, {silentFit:true});
      setLevel2Checked('met',  state.systems.met.ui.chkExp, v, {silentFit:true});
    });
    syncAllTri();
  }
  function onLevel2ChangeMet(groupChk){
    const v = groupChk.checked;
    bulk(()=> setLevel2Checked('met', groupChk, v, {silentFit:true}));
    syncAllTri();
  }

  // Alimentadores
  function onLevel1ChangeAlim(){
    const v = state.systems.alim.ui.chkAll.checked;
    bulk(()=>{
      setLevel2Checked('alim', state.systems.alim.ui.chkN, v, {silentFit:true});
      setLevel2Checked('alim', state.systems.alim.ui.chkS, v, {silentFit:true});
    });
    syncAllTri();
  }
  function onLevel2ChangeAlim(groupChk){
    const v = groupChk.checked;
    bulk(()=> setLevel2Checked('alim', groupChk, v, {silentFit:true}));
    syncAllTri();
  }

  // Corredores
  function onLevel1ChangeCorr(){
    const v = state.systems.corr.ui.chkAll.checked;
    bulk(()=>{
      for (const {chk} of state.systems.corr.ui.groups.values()){
        setLevel2Checked('corr', chk, v, {silentFit:true});
      }
    });
    syncAllTri();
  }
  function onLevel2ChangeCorr(groupChk){
    const v = groupChk.checked;
    bulk(()=> setLevel2Checked('corr', groupChk, v, {silentFit:true}));
    syncAllTri();
  }

  // Metro
  function onLevel1ChangeMetro(){
    const v = state.systems.metro.ui.chkAll.checked;
    bulk(()=> setLevel2Checked('metro', state.systems.metro.ui.chkAll, v, {silentFit:true}));
    syncAllTri();
  }

  function syncTriOfGroup(systemId, groupChk){
    const leaves = routeCheckboxesOf(systemId, groupChk);
    const total = leaves.length;
    const checked = leaves.filter(c=>c.checked).length;
    groupChk && (groupChk.indeterminate = checked>0 && checked<total);
    groupChk && (groupChk.checked = total>0 && checked===total);
  }

  function syncTriFromLeaf(systemId){
    if (systemId==='met'){
      syncTriOfGroup('met', state.systems.met.ui.chkReg);
      syncTriOfGroup('met', state.systems.met.ui.chkExp);
      const b = [state.systems.met.ui.chkReg, state.systems.met.ui.chkExp];
      const allChecked = b.every(x => x && x.checked);
      const anyChecked = b.some(x => x && (x.checked || x.indeterminate));
      const top = state.systems.met.ui.chkAll;
      top.indeterminate = anyChecked && !allChecked;
      top.checked = allChecked;
    } else if (systemId==='alim'){
      syncTriOfGroup('alim', state.systems.alim.ui.chkN);
      syncTriOfGroup('alim', state.systems.alim.ui.chkS);
      const b = [state.systems.alim.ui.chkN, state.systems.alim.ui.chkS];
      const allChecked = b.every(x => x && x.checked);
      const anyChecked = b.some(x => x && (x.checked || x.indeterminate));
      const top = state.systems.alim.ui.chkAll;
      top.indeterminate = anyChecked && !allChecked;
      top.checked = allChecked;
    } else if (systemId==='corr'){
      for (const {chk} of state.systems.corr.ui.groups.values()){ syncTriOfGroup('corr', chk); }
      const leaves = routeCheckboxesOf('corr');
      const total = leaves.length;
      const checked = leaves.filter(c=>c.checked).length;
      const top = state.systems.corr.ui.chkAll;
      top.indeterminate = checked>0 && checked<total;
      top.checked = total>0 && checked===total;
    } else if (systemId==='metro'){
      const top = state.systems.metro.ui.chkAll;
      const leaves = routeCheckboxesOf('metro');
      const total = leaves.length;
      const checked = leaves.filter(c=>c.checked).length;
      top.indeterminate = checked>0 && checked<total;
      top.checked = total>0 && checked===total;
    }
  }
  function syncAllTri(){ ['met','alim','corr','metro'].forEach(syncTriFromLeaf); }

  function wireHierarchy(){
    // Met
    state.systems.met.ui.chkAll.addEventListener('change', onLevel1ChangeMet);
    state.systems.met.ui.chkReg.addEventListener('change', ()=> onLevel2ChangeMet(state.systems.met.ui.chkReg));
    state.systems.met.ui.chkExp.addEventListener('change', ()=> onLevel2ChangeMet(state.systems.met.ui.chkExp));

    // Alimentadores
    state.systems.alim.ui.chkAll.addEventListener('change', onLevel1ChangeAlim);
    state.systems.alim.ui.chkN  .addEventListener('change', ()=> onLevel2ChangeAlim(state.systems.alim.ui.chkN));
    state.systems.alim.ui.chkS  .addEventListener('change', ()=> onLevel2ChangeAlim(state.systems.alim.ui.chkS));

    // Corredores
    state.systems.corr.ui.chkAll.addEventListener('change', onLevel1ChangeCorr);

    // Metro
    state.systems.metro.ui.chkAll.addEventListener('change', onLevel1ChangeMetro);

    syncAllTri();
  }

  // ------------------------------
  // Render de servicios (mapa)
  // ------------------------------
  function getStopLatLng(sys, id){
    const s = sys.stops.get(id);
    if (!s) return null;
    return [s.lat, s.lon];
  }
  function uniqueOrder(arr){
    const out = []; let last = null;
    for (const a of arr){ if (!a) continue; if (!last || (a[0]!==last[0] || a[1]!==last[1])) out.push(a); last = a; }
    return out;
  }
  function ensureGroups(sys, id){
    if (!sys.lineLayers.has(id)) sys.lineLayers.set(id, L.layerGroup().addTo(state.map));
    if (!sys.stopLayers.has(id)) sys.stopLayers.set(id, L.layerGroup().addTo(state.map));
  }
  function clearServiceLayers(sys, id){
    const g1 = sys.lineLayers.get(id);
    const g2 = sys.stopLayers.get(id);
    if (g1) g1.clearLayers(); if (g2) g2.clearLayers();
  }
  function fitTo(bounds){
    if (!bounds) return;
    const leftPad = document.getElementById('sidebar')?.offsetWidth ?? 380;
    state.map.fitBounds(bounds, { paddingTopLeft: [leftPad + 20, 40], paddingBottomRight: [30, 40] });
  }

  function renderService(systemId, id, opts={}){
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
        if (!Array.isArray(seg) || seg.length<2) return;
        const poly = L.polyline(seg, { color: color, weight: 4, opacity: 0.95 }).addTo(gLine);
        bounds = bounds ? bounds.extend(poly.getBounds()) : poly.getBounds();
      });
    };

    const drawByStops = (ids, color) => {
      const pts = uniqueOrder(ids.map(st => getStopLatLng(sys, st)).filter(Boolean));
      if (pts.length >= 2){
        const poly = L.polyline(pts, { color: color, weight: 4, opacity: 0.95 }).addTo(gLine);
        bounds = bounds ? bounds.extend(poly.getBounds()) : poly.getBounds();
      }
    };

    const routeDir = getDirFor(systemId, id);

    if (systemId==='alim'){
      if (routeDir === 'ambas')       drawSegments(svc.geom.length?svc.geom:[...(svc.geom_norte||[]), ...(svc.geom_sur||[])], svc.color);
      else if (routeDir === 'norte')  drawSegments(svc.geom_norte || svc.geom, svc.color);
      else if (routeDir === 'sur')    drawSegments(svc.geom_sur   || svc.geom, svc.color);
    } else if (systemId==='met' && svc.kind === 'regular'){
      drawByStops(svc.stops || [], svc.color);
    } else if (systemId==='met') {
      if (routeDir === 'ambas'){
        if (state.dir === 'ambas' || state.dir === 'ns') drawByStops(svc.north_south || [], svc.color);
        if (state.dir === 'ambas' || state.dir === 'sn') drawByStops(svc.south_north || [], svc.color);
      } else if (routeDir === 'norte'){ drawByStops(svc.south_north || [], svc.color); }
      else if (routeDir === 'sur'){     drawByStops(svc.north_south || [], svc.color); }
    } else if (systemId==='corr'){
      if (svc.segments?.length) drawSegments(svc.segments, svc.color);
      else if (svc.stops?.length) drawByStops(svc.stops, svc.color);
    } else if (systemId==='metro'){
      drawSegments(svc.segments || [], svc.color);
    }

    if (state.showStops && Array.isArray(svc.stops)){
      const used = new Set();
      svc.stops.forEach(st => {
        if (used.has(st)) return; used.add(st);
        const ll = getStopLatLng(sys, st);
        if (!ll) return;
        const marker = L.marker(ll, { icon: L.divIcon({ className:'stop-pin', iconSize:[16,16] }) }).addTo(gStop);
        const nm = sys.stops.get(st)?.name || st;
        marker.bindTooltip(nm, {permanent:false, direction:'top'});
      });
    }

    if (state.autoFit && bounds && !silentFit) fitTo(bounds.pad(0.04));
  }

  function hideService(systemId, id){
    const sys = state.systems[systemId];
    const g1 = sys.lineLayers.get(id);
    const g2 = sys.stopLayers.get(id);
    if (g1) g1.clearLayers();
    if (g2) g2.clearLayers();
  }

  function onToggleService(systemId, id, checked, opts={}){
    if (checked) renderService(systemId, id, opts);
    else hideService(systemId, id);
  }

  function reRenderVisibleSystem(sysId){
    const sel =
      sysId==='met'   ? '#p-met-reg .item input[type=checkbox], #p-met-exp .item input[type=checkbox]' :
      sysId==='alim'  ? '#p-met-alim .item input[type=checkbox]' :
      sysId==='corr'  ? '#p-corr .item input[type=checkbox]' :
      '#p-metro .item input[type=checkbox]';
    $$(sel).forEach(chk=>{
      if (chk.checked) onToggleService(sysId, chk.dataset.id, true, {silentFit:true});
      else hideService(sysId, chk.dataset.id);
    });
  }
  function reRenderVisible(){ ['met','alim','corr','metro'].forEach(reRenderVisibleSystem); }

  function setBase(theme){
    if (theme === state.currentBase) return;
    state.map.removeLayer(state.baseLayers[state.currentBase]);
    state.map.addLayer(state.baseLayers[theme]);
    state.currentBase = theme;
  }

  // ------------------------------
  // Búsqueda (autocompletado)
  // ------------------------------
  function svcAliases(s, systemId) {
    const id = String(s.id).toLowerCase();
    const base = [id, (s.name||'').toLowerCase()];
    if (systemId === 'met') {
      if (s.kind === 'regular') base.push(`ruta ${id}`, `metropolitano ${id}`, `troncal ${id}`);
      else base.push(`expreso ${id}`, `servicio ${id}`, `metropolitano expreso ${id}`);
      if (id === 'sxn') base.push('super expreso norte', 'sxn');
      if (id === 'sx')  base.push('super expreso', 'sx');
      if (id === 'l')   base.push('lechucero', 'servicio l');
    } else if (systemId === 'alim') {
      base.push(`alimentador ${id}`, `metropolitano ${id}`);
    } else if (systemId === 'corr') {
      base.push(`corredor ${id}`, `ruta ${id}`, `expreso ${id}`);
    } else if (systemId === 'metro') {
      base.push(`metro ${id}`, `línea ${id}`, `linea ${id}`);
    }
    return base;
  }
  function buildIndexForSearch() {
    const idxMet  = state.systems.met.services  .map(s => ({ system:'met',   id:s.id, kind:s.kind, color:s.color, name:s.name||'', label:'Metropolitano',   aliases: svcAliases(s,'met')  }));
    const idxAlm  = state.systems.alim.services .map(s => ({ system:'alim',  id:s.id, kind:'alim', color:s.color, name:s.name||'', label:'Alimentadores', aliases: svcAliases(s,'alim') }));
    const idxCorr = state.systems.corr.services .map(s => ({ system:'corr',  id:s.id, kind:s.kind, color:s.color, name:s.name||'', label:'Corredores',    aliases: svcAliases(s,'corr') }));
    const idxMet2 = state.systems.metro.services.map(s => ({ system:'metro', id:s.id, kind:'metro',color:s.color, name:s.name||'', label:'Metro',          aliases: svcAliases(s,'metro') }));
    state._searchIndex = [...idxMet, ...idxAlm, ...idxCorr, ...idxMet2];
  }

  let _suggestEl, _searchInput;
  function openSuggest(){ _suggestEl.classList.add('open'); }
  function closeSuggest(){ _suggestEl.classList.remove('open'); _suggestEl.innerHTML=''; }

  function renderSuggest(items){
    _suggestEl.innerHTML = '';
    if (!items.length) { closeSuggest(); return; }
    const frag = document.createDocumentFragment();
    items.slice(0, 12).forEach(s => {
      const ico = document.createElement('span'); ico.className = 's-ico';
      const img = new Image();

      if (s.system==='metro'){
        const code = String(s.id).toUpperCase();
        const fileBaseNow = code.replace(/^L/i,'');
        const primary = `${PATHS.icons.metro}/${fileBaseNow}.png`;
        const alt     = `${PATHS.icons.metro}/${code}.png`;
        img.src = primary;
        img.onerror = () => {
          if (!img.dataset.altTried){ img.dataset.altTried='1'; img.src = alt; }
          else { ico.style.background = s.color; ico.textContent = String(s.id).toUpperCase(); }
        };
      } else {
        const iconPath =
          s.system==='met'   ? `${PATHS.icons.met}/${String(s.id).toUpperCase()}.png`   :
          s.system==='corr'  ? `${PATHS.icons.corr}/${String(s.id).toUpperCase()}.png`  :
          '';
        if (iconPath) {
          img.src = iconPath;
          img.onerror = () => { ico.style.background = s.color; ico.textContent = String(s.id).toUpperCase(); };
        } else {
          ico.style.background = s.color; ico.textContent = String(s.id).toUpperCase();
        }
      }

      img.onload  = () => { ico.appendChild(img); };

      const row = document.createElement('div'); row.className='suggest-item'; row.setAttribute('role','option'); row.dataset.id=s.id; row.dataset.system=s.system;
      const box = document.createElement('div');
      const l1 = document.createElement('div'); l1.className='s-label';
      const prefix =
        s.system==='met'   ? (s.kind==='regular'?'Ruta ':'Expreso ') :
        s.system==='alim'  ? 'Alim. ' :
        s.system==='corr'  ? 'Corredor ' :
        'Línea ';
      l1.textContent = prefix + s.id;
      const l2 = document.createElement('div'); l2.className='s-sub'; l2.textContent = (s.name||'') + (s.label ? ` — ${s.label}` : '');
      box.append(l1,l2);
      row.append(ico, box);
      row.addEventListener('mousedown', (e)=>{ e.preventDefault(); selectServiceFromSearch(s.system, s.id); });
      frag.appendChild(row);
    });
    _suggestEl.appendChild(frag); openSuggest();
  }

  function selectServiceFromSearch(systemId, id){
    bulk(()=>{
      ['met','alim','corr','metro'].forEach(sysId => {
        const all = routeCheckboxesOf(sysId);
        all.forEach(chk => setLeafChecked(sysId, chk, false, {silentFit:true}));
      });
      const selector =
        systemId==='met'   ? '#p-met-reg .item input[type=checkbox], #p-met-exp .item input[type=checkbox]' :
        systemId==='alim'  ? '#p-met-alim .item input[type=checkbox]' :
        systemId==='corr'  ? '#p-corr .item input[type=checkbox]' :
        '#p-metro .item input[type=checkbox]';
      const all = $$(selector);
      all.forEach(chk=>{
        const hit = (chk.dataset.id.toUpperCase() === String(id).toUpperCase());
        if (hit) setLeafChecked(systemId, chk, true, {silentFit:true});
      });
      syncAllTri();
    });
    closeSuggest();
  }

  function setupTypeahead(){
    _searchInput = document.getElementById('searchInput');
    _suggestEl   = document.getElementById('searchSuggest');
    buildIndexForSearch();

    let t;
    _searchInput.addEventListener('input', ()=>{
      const q = _searchInput.value.trim().toLowerCase();
      clearTimeout(t);
      if (!q) { closeSuggest(); return; }
      t = setTimeout(()=>{
        const results = state._searchIndex.filter(s => s.aliases.some(a => a.includes(q)));
        renderSuggest(results);
      }, 90);
    });

    _searchInput.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape'){ closeSuggest(); }
      if (e.key === 'Enter'){
        const first = _suggestEl.querySelector('.suggest-item');
        if (first){ selectServiceFromSearch(first.dataset.system, first.dataset.id); }
        e.preventDefault();
      }
    });

    document.addEventListener('click', (e)=>{
      if (!_suggestEl.contains(e.target) && e.target !== _searchInput) closeSuggest();
    });

    const clearBtn = document.getElementById('btnClearSearch');
    clearBtn?.addEventListener('click', ()=>{ _searchInput.value = ''; closeSuggest(); });
  }

  // ------------------------------
  // INIT
  // ------------------------------
  async function init(){
    initMap();

    // Catálogo
    try {
      state.catalog = await fetchJSON(`${PATHS.data}/config/catalog.json`);
      console.log('[Catálogo] Usando config/catalog.json');
    } catch {
      state.catalog = await fetchJSON(`${PATHS.data}/catalog.json`).catch(()=>null);
      console.log('[Catálogo] Usando data/catalog.json');
    }

    // Metropolitano
    const stopsMet = await fetchJSON(`${PATHS.met}/metropolitano_stops.json`);
    const svcsMet  = await fetchJSON(`${PATHS.met}/metropolitano_services.json`);
    state.systems.met.stops = stopsArrayToMap(stopsMet.stations);
    const colorsMet = svcsMet.colors || {};
    const metAll = (svcsMet.services || []).map(s => ({ ...s, system:'met', color: colorsMet[String(s.id)] || '#0ea5e9' }));
    state.systems.met.services = filterByCatalogFor('met', metAll, state.catalog);

    // Alimentadores
    try{
      const alim = await fetchJSON(`${PATHS.met}/alimentadores.json`);
      if (alim?.type === 'FeatureCollection'){
        const parsed = buildAlimFromFC(alim);
        state.systems.alim.stops    = parsed.stops;
        state.systems.alim.services = filterByCatalogFor('alim', parsed.services, state.catalog);
        console.log('[Alimentadores] Rutas creadas:', parsed.services.length);
      } else {
        console.warn('[Alimentadores] El archivo no es FeatureCollection o está vacío.');
      }
    }catch(e){
      console.warn('Alimentadores no disponibles:', e.message);
    }

    // Corredores
    try{
      const corrRaw = await fetchJSON(`${PATHS.corr}/corredores.json`);
      let services = [];
      let infoLog  = '';

      if (corrRaw?.type === 'FeatureCollection'){
        const parsed = buildCorredoresFromFC(corrRaw);
        state.systems.corr.stops    = parsed.stops;
        services                     = parsed.services;
        infoLog = `[Corredores] Rutas creadas: ${services.length} | Features sin ref: ${parsed.noRef}`;
      } else if (Array.isArray(corrRaw?.services)) {
        services = corrRaw.services;
        state.systems.corr.stops = corrRaw.stops ? stopsArrayToMap(corrRaw.stops) : new Map();
        infoLog = `[Corredores] Rutas (obj): ${services.length}`;
      } else {
        console.warn('[Corredores] Formato no reconocido:', corrRaw?.type ?? typeof corrRaw);
        state.systems.corr.stops = new Map();
        services = [];
      }

      state.systems.corr.services = filterByCatalogFor('corr', services, state.catalog);
      if (infoLog) console.log(infoLog);
      console.log('[Corredores] Rutas finales:', state.systems.corr.services.length);
    }catch(e){
      console.warn('Corredores no disponibles:', e.message);
      state.systems.corr.stops = new Map();
      state.systems.corr.services = [];
    }

    // Metro
    try{
      const metroRaw = await fetchJSON(`${PATHS.metro}/metro.json`);
      const parsed = buildMetroFromJSON(metroRaw);
      state.systems.metro.stops    = parsed.stops;
      state.systems.metro.services = filterByCatalogFor('metro', parsed.services, state.catalog);
      console.log('[Metro] Líneas detectadas:', state.systems.metro.services.map(s=>s.id).join(', ')||'—');
    }catch(e){
      console.warn('Metro no disponible:', e.message);
    }

    // Construir UI
    buildUI();
  }

  function buildUI(){
    // refs Metropolitano
    state.systems.met.ui.listReg = $('#p-met-reg');
    state.systems.met.ui.listExp = $('#p-met-exp');
    state.systems.met.ui.chkAll  = $('#chk-met');
    state.systems.met.ui.chkReg  = $('#chk-met-reg');
    state.systems.met.ui.chkExp  = $('#chk-met-exp');

    // refs Alimentadores
    state.systems.alim.ui.listN  = $('#p-met-alim-n');
    state.systems.alim.ui.listS  = $('#p-met-alim-s');
    state.systems.alim.ui.chkAll = $('#chk-met-alim');
    state.systems.alim.ui.chkN   = $('#chk-met-alim-n');
    state.systems.alim.ui.chkS   = $('#chk-met-alim-s');

    // refs Corredores
    state.systems.corr.ui.list   = $('#p-corr-list');
    state.systems.corr.ui.chkAll = $('#chk-corr');

    // refs Metro
    state.systems.metro.ui.list  = $('#p-metro');
    state.systems.metro.ui.chkAll= $('#chk-metro');

    // Llenar listas
    fillMetList();
    fillAlimList();
    fillCorrList();
    fillMetroList();

    // Cableado
    wireHierarchy();

    // Opciones globales
    $('#btnLight')?.addEventListener('click', ()=> setBase('light'));
    $('#btnDark') ?.addEventListener('click', ()=> setBase('dark'));

    $$('input[name="dir"]').forEach(r=>{
      r.addEventListener('change',()=>{ if (r.checked){ state.dir = r.value; reRenderVisibleSystem('met'); } });
    });

    const chkStops = $('#chkStops');
    if (chkStops){
      chkStops.checked = true;
      chkStops.addEventListener('change',()=>{ state.showStops = chkStops.checked; reRenderVisible(); });
    }

    const chkFit = $('#chkAutoFit');
    if (chkFit){
      chkFit.checked = true;
      chkFit.addEventListener('change',()=>{ state.autoFit = chkFit.checked; });
    }

    // Desmarcar todo
    $('#btnClearAll')?.addEventListener('click', ()=>{
      bulk(()=>{
        // Met
        setLevel2Checked('met',  state.systems.met.ui.chkReg, false, {silentFit:true});
        setLevel2Checked('met',  state.systems.met.ui.chkExp, false, {silentFit:true});
        state.systems.met.ui.chkAll.checked = false;
        // Alim
        setLevel2Checked('alim', state.systems.alim.ui.chkN,  false, {silentFit:true});
        setLevel2Checked('alim', state.systems.alim.ui.chkS,  false, {silentFit:true});
        state.systems.alim.ui.chkAll.checked = false;
        // Corr
        if (state.systems.corr.ui.chkAll){
          state.systems.corr.ui.chkAll.checked = false;
          onLevel1ChangeCorr();
        }
        // Metro
        if (state.systems.metro.ui.chkAll){
          state.systems.metro.ui.chkAll.checked = false;
          onLevel1ChangeMetro();
        }
      });
      syncAllTri();
    });

    setupTypeahead();
    wirePanelTogglesOnce();

    $('#status') && ($('#status').textContent = 'Listo');
  }

  init().catch(err=>{
    console.error(err);
    $('#status') && ($('#status').textContent = 'Error al iniciar');
  });
})();

/* ====== Desplegables (triangulitos) ====== */
function wirePanelTogglesOnce() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.dataset.togglesWired === '1') return;
  sidebar.dataset.togglesWired = '1';

  sidebar.addEventListener('click', (e) => {
    const head = e.target.closest('.panel-head');
    if (!head || !sidebar.contains(head)) return;
    if (e.target.closest('input[type="checkbox"]')) return;
    const panel = head.closest('.panel');
    const body = document.getElementById(head.dataset.target);
    panel.classList.toggle('open');
    head.setAttribute('aria-expanded', String(panel.classList.contains('open')));
    if (body) body.style.display = panel.classList.contains('open') ? 'block' : 'none';
  });

  sidebar.addEventListener('keydown', (e) => {
    const head = e.target.closest('.panel-head');
    if (!head || !sidebar.contains(head)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const panel = head.closest('.panel');
      const body = document.getElementById(head.dataset.target);
      panel.classList.toggle('open');
      head.setAttribute('aria-expanded', String(panel.classList.contains('open')));
      if (body) body.style.display = panel.classList.contains('open') ? 'block' : 'none';
    }
  });
}
 