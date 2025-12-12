// uiSidebar.js
import { PATHS, COLOR_AN, COLOR_AS, state, getDirFor, setDirFor } from './config.js';
import { $, $$, el } from './utils.js';
import { onToggleService, setWikiroutesVisible } from './mapLayers.js';

// Utilidad de "operaciones en lote"
export function bulk(fn){
  state.bulk = true;
  try { fn(); } finally { state.bulk = false; }
}

const labelForSvc = (s) =>
  s.kind==='regular' ? 'Ruta' : (s.kind==='expreso' ? 'Expreso' : 'Servicio');

// Colores oficiales para corredores según primer dígito del servicio
const CORR_COLORS = {
  '1': '#ffcd00', // Amarillo
  '2': '#e4002b', // Rojo
  '3': '#003594', // Azul
  '4': '#9b26b6', // Morado
  '5': '#8e8c13'  // Verde
};

function corrColorForId(id){
  const s = String(id || '').trim();
  if (!s) return null;
  const first = s[0];
  return CORR_COLORS[first] || null;
}

// Direcciones mini (Norte/Sur/Ambas) para Met/Alim
function miniDir(systemId, svc){
  if (systemId === 'corr' || systemId === 'metro') return el('div');
  const cur = getDirFor(systemId, svc.id);
  const wrap = el('div',{class:'dir-mini'});
  const mk = (val,label,title) =>
    el('button',{class:`segbtn-mini${cur===val?' active':''}`,'data-dir':val,title},label);

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
        setLeafChecked(systemId, chk, true, {silentFit:true});
        syncTriFromLeaf(systemId);
      } else {
        onToggleService(systemId, svc.id, true, {silentFit:true});
      }
    }
  });
  return wrap;
}

/* =========================
   Items por sistema
   ========================= */

function makeServiceItemMet(svc){
  const img = el('img', {
    src:`${PATHS.icons.met}/${String(svc.id).toUpperCase()}.png`,
    class:'badge',
    alt:svc.id
  });
  img.onerror = () =>
    img.replaceWith(
      el('span',{class:'badge', style:`background:${svc.color}`}, String(svc.id))
    );

  const left = el('div',{class:'left'},
    img,
    el('div',{},
      el('div',{class:'name'}, `${labelForSvc(svc)} ${svc.id}`),
      el('div',{class:'sub'}, svc.name || '')
    )
  );
  const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'met'});
  const head = el('div',{class:'item-head'}, left, chk);
  const body = el('div',{class:'item'}, head, miniDir('met', svc));
  chk.addEventListener('change', () => {
    if (!state.bulk) {
      onToggleService('met', svc.id, chk.checked);
      syncTriFromLeaf('met');
    }
  });
  return body;
}

function makeServiceItemAlim(svc){
  const code = String(svc.id).toUpperCase();
  const tag = el('span',{
    class:'tag',
    style:`background:${svc.color || (code.startsWith('AN')?COLOR_AN:COLOR_AS)}`
  }, code);
  const left = el('div',{class:'left'},
    tag,
    el('div',{},
      el('div',{class:'name'}, svc.name || `Alimentador ${code}`),
      el('div',{class:'sub'}, `Zona ${svc.zone==='NORTE'?'Norte':'Sur'}`)
    )
  );
  const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'alim'});
  const head = el('div',{class:'item-head'}, left, chk);
  const body = el('div',{class:'item'}, head, miniDir('alim', svc));
  chk.addEventListener('change', () => {
    if (!state.bulk) {
      onToggleService('alim', svc.id, chk.checked);
      syncTriFromLeaf('alim');
    }
  });
  return body;
}

function makeServiceItemCorr(svc){
  const code = String(svc.id);
  const color = corrColorForId(code) || svc.color || '#10b981';

  const tag = el('span',{class:'tag', style:`background:${color}`}, code);
  const left = el('div',{class:'left'},
    tag,
    el('div',{},
      el('div',{class:'name'}, `Servicio ${code}`),
      el('div',{class:'sub'}, svc.name || '')
    )
  );
  const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'corr'});
  const head = el('div',{class:'item-head'}, left, chk);
  const body = el('div',{class:'item'}, head);
  chk.addEventListener('change', () => {
    if (!state.bulk) {
      onToggleService('corr', svc.id, chk.checked);
      syncTriFromLeaf('corr');
    }
  });
  return body;
}

function makeServiceItemMetro(svc){
  const code = String(svc.id).toUpperCase();
  const fileBaseNow = code.replace(/^L/i, '');
  const primary = `${PATHS.icons.metro}/${fileBaseNow}.png`;
  const alt     = `${PATHS.icons.metro}/${code}.png`;
  const ico = new Image();
  ico.alt = code;
  ico.className = 'badge';
  ico.src = primary;
  ico.onerror = () => {
    if (!ico.dataset.altTried) {
      ico.dataset.altTried = '1';
      ico.src = alt;
    } else {
      ico.replaceWith(
        el('span',{class:'tag', style:`background:${svc.color}`}, code)
      );
    }
  };
  const left = el('div',{class:'left'},
    ico,
    el('div',{},
      el('div',{class:'name'}, `Línea ${code}`),
      el('div',{class:'sub'}, svc.name || '')
    )
  );
  const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'metro'});
  const head = el('div',{class:'item-head'}, left, chk);
  const body = el('div',{class:'item'}, head);
  chk.addEventListener('change', () => {
    if (!state.bulk) {
      onToggleService('metro', svc.id, chk.checked);
      syncTriFromLeaf('metro');
    }
  });
  return body;
}

/* =============== Wikiroutes (ítem combinado Ida/Vuelta) =============== */

/* ---- Carga de lista_rutas.csv / wr_extremes.json y helpers de texto ---- */

let wrListaMetaPromise = null;
let wrExtremesPromise = null;

function wrCanonicalCode(value){
  const s = String(value||'').trim();
  if (!s) return '';
  const n = Number(s);
  if (!Number.isNaN(n)) return String(n);
  return s.toUpperCase();
}

function loadWrListaMeta(){
  if (!wrListaMetaPromise){
    wrListaMetaPromise = fetch('config/lista_rutas.csv')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(text => {
        const lines = text.trim().split(/\r?\n/);
        const metaByCodigo = {};
        if (!lines.length) return metaByCodigo;

        const header = lines[0].split(',');
        const idxCodigo  = header.findIndex(h => h.trim() === 'codigo_nuevo');
        const idxOri     = header.findIndex(h => h.trim() === 'distrito_origen');
        const idxDes     = header.findIndex(h => h.trim() === 'distrito_destino');
        const idxEmp     = header.findIndex(h => h.trim() === 'empresa_operadora');
        const idxAlias   = header.findIndex(h => h.trim() === 'alias');

        for (let i = 1; i < lines.length; i++){
          const raw = lines[i].trim();
          if (!raw) continue;
          const cols = raw.split(',');
          const codigo = (idxCodigo>=0 && cols[idxCodigo]) ? cols[idxCodigo].trim() : '';
          if (!codigo) continue;
          const key = wrCanonicalCode(codigo);
          metaByCodigo[key] = {
            codigo_nuevo: codigo,
            distrito_origen: idxOri>=0 ? (cols[idxOri] || '').trim() : '',
            distrito_destino: idxDes>=0 ? (cols[idxDes] || '').trim() : '',
            empresa_operadora: idxEmp>=0 ? (cols[idxEmp] || '').trim() : '',
            alias: idxAlias>=0 ? (cols[idxAlias] || '').trim() : ''
          };
        }
        return metaByCodigo;
      })
      .catch(err => {
        console.error('No se pudo cargar config/lista_rutas.csv', err);
        return {};
      });
  }
  return wrListaMetaPromise;
}

function loadWrExtremes(){
  if (!wrExtremesPromise){
    wrExtremesPromise = fetch('config/wr_extremes.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .catch(err => {
        console.error('No se pudo cargar config/wr_extremes.json', err);
        return {};
      });
  }
  return wrExtremesPromise;
}

// Valores tipo "Ninguno", "Desconocido", etc.
function wrIsPlaceholder(text){
  if (!text) return false;
  const n = String(text).trim().toLowerCase();
  return (
    n === 'ninguno' ||
    n === 'ninguna' ||
    n === 'desconocido' ||
    n === 'desconocida' ||
    n === '?' ||
    n === '¿?' ||
    n === '-' ||
    n === 'sin nombre'
  );
}

// Busca todas las siglas entre paréntesis
function wrFindSiglasEmpresa(empresa){
  if (!empresa) return '';
  const matches = [...empresa.matchAll(/\(([^)]+)\)/g)];
  if (!matches.length) return '';

  if (matches.length === 1){
    return matches[0][1].trim();
  }

  let withE = null;
  for (const m of matches){
    const txt = m[1].trim();
    if (txt && txt[0].toUpperCase() === 'E'){
      withE = txt;
      break;
    }
  }
  if (withE) return withE;
  return matches[0][1].trim();
}

// Versión recortada del nombre de empresa cuando no hay siglas ni alias
function wrBuildEmpresaDisplay(empresaRaw){
  if (!empresaRaw) return '';
  let s = empresaRaw.trim();
  if (s.length <= 30) return s;

  const prefixes = [
    'Empresa de Transportes y Servicios',
    'Empresa de Transportes',
    'Empresa de Transporte'
  ];
  for (const pref of prefixes){
    const needle = pref + ' ';
    if (s.startsWith(needle)){
      s = s.slice(needle.length);
      break;
    }
  }

  const suffixes = [' S.A.C.', ' S.A.'];
  for (const suf of suffixes){
    if (s.endsWith(suf)){
      s = s.slice(0, s.length - suf.length);
      break;
    }
  }

  return s.trim();
}

function wrBuildTituloPrincipal(meta, rt){
  const rawAlias = meta && meta.alias ? String(meta.alias).trim() : '';
  const alias = rawAlias && !wrIsPlaceholder(rawAlias) ? rawAlias : '';

  const rawEmpresa = meta && meta.empresa_operadora
    ? String(meta.empresa_operadora).trim()
    : '';
  const empresa = rawEmpresa && !wrIsPlaceholder(rawEmpresa) ? rawEmpresa : '';
  const siglas  = wrFindSiglasEmpresa(rawEmpresa);

  if (alias){
    if (siglas){
      return `${alias} - ${siglas}`;
    }
    return alias;
  }

  if (siglas){
    return siglas;
  }
  if (empresa){
    return wrBuildEmpresaDisplay(empresa);
  }

  if (rt && rt.id != null){
    return String(rt.id).toUpperCase();
  }
  return '';
}

// Intenta obtener paraderos extremos de un objeto de ruta o un string
function wrParseBaseStops(source){
  if (!source) return {from:'', to:'', label:''};

  // Si es string directo
  if (typeof source === 'string'){
    const raw = source.trim();
    if (!raw) return {from:'', to:'', label:''};
    let s = raw;
    s = s.replace(/^\s*\d+\s*·\s*/,'');

    s = s.replace(/\s*\((ida|vuelta)\)\s*$/i,'');

    let parts = s.split('→');
    if (parts.length === 2){
      const from = parts[0].trim();
      const to   = parts[1].trim();
      return {from, to, label:`${from} \u2192 ${to}`};
    }
    parts = s.split(/\s*-\s*/);
    if (parts.length === 2){
      const from = parts[0].trim();
      const to   = parts[1].trim();
      return {from, to, label:`${from} \u2192 ${to}`};
    }
    return {from:'', to:'', label:s.trim()};
  }

  // Si es objeto
  const props = source;
  // Intentar campos directos tipo from/to
  const directFrom =
    props.from ||
    props.from_short ||
    props.fromShort ||
    props.origen ||
    props.origin ||
    null;
  const directTo =
    props.to ||
    props.to_short ||
    props.toShort ||
    props.destino ||
    props.destination ||
    null;

  if (directFrom || directTo){
    const from = String(directFrom || '').trim();
    const to   = String(directTo || '').trim();
    const label = (from || to) ? `${from} \u2192 ${to}` : '';
    return {from, to, label};
  }

  // Si hay lista de paraderos con nombre, usar primero y último
  if (Array.isArray(props.stops) && props.stops.length){
    const first = props.stops[0];
    const last  = props.stops[props.stops.length - 1];
    const getName = st => {
      if (!st) return '';
      return (
        st.name ||
        st.title ||
        st.label ||
        ''
      );
    };
    const from = String(getName(first) || '').trim();
    const to   = String(getName(last) || '').trim();
    const label = (from || to) ? `${from} \u2192 ${to}` : '';
    return {from, to, label};
  }

  // Finalmente, intentar con name/title
  let rawName = '';
  if (props.name != null) rawName = String(props.name);
  else if (props.title != null) rawName = String(props.title);
  else rawName = '';

  if (!rawName.trim()) return {from:'', to:'', label:''};

  let s = rawName;
  s = s.replace(/^\s*\d+\s*·\s*/,'');

  s = s.replace(/\s*\((ida|vuelta)\)\s*$/i,'');

  let parts = s.split('→');
  if (parts.length === 2){
    const from = parts[0].trim();
    const to   = parts[1].trim();
    return {from, to, label:`${from} \u2192 ${to}`};
  }

  parts = s.split(/\s*-\s*/);
  if (parts.length === 2){
    const from = parts[0].trim();
    const to   = parts[1].trim();
    return {from, to, label:`${from} \u2192 ${to}`};
  }

  return {from:'', to:'', label:s.trim()};
}

// Usa wr_extremes.json para obtener extremos si hay match
function wrStopsFromExtremesForRoute(routeLike, extremes, dirKey){
  if (!routeLike || !extremes) return null;

  const candidates = [];

  // Si nos pasan directamente un id numérico o string, úsalo tal cual
  if (typeof routeLike === 'string' || typeof routeLike === 'number'){
    candidates.push(routeLike);
  } else {
    const r = routeLike;
    if (r.wr_id   != null) candidates.push(r.wr_id);
    if (r.wrId    != null) candidates.push(r.wrId);
    if (r.route_id!= null) candidates.push(r.route_id);
    if (r.routeId != null) candidates.push(r.routeId);
    if (r.base_id != null) candidates.push(r.base_id);
    if (r.id      != null) candidates.push(r.id);
  }

  for (const c of candidates){
    const key = String(c);
    const ext = extremes[key];
    if (ext && ext[dirKey]){
      const from = ext[dirKey].from ? String(ext[dirKey].from).trim() : '';
      const to   = ext[dirKey].to   ? String(ext[dirKey].to).trim()   : '';
      const label = (from || to) ? `${from} \u2192 ${to}` : '';
      return {from, to, label};
    }
  }
  return null;
}

function applyWrTextsToWrItem(item, direccion){
  const rt    = item.__wrRoute || null;
  const meta  = item.__wrMeta  || null;

  const stopsIda     = item.__wrStopsIda || null;
  const stopsVta     = item.__wrStopsVta || null;
  const stopsDefault = item.__wrStops    || null;

  let stops;
  if (direccion === 'vuelta'){
    stops = stopsVta || stopsIda || stopsDefault;
  } else {
    stops = stopsIda || stopsDefault;
  }

  const titleEl = item.querySelector('.wr-main-title');
  const distEl  = item.querySelector('.wr-subtitle-dist');
  const routeEl = item.querySelector('.wr-subtitle-route');

  if (titleEl){
    titleEl.textContent = wrBuildTituloPrincipal(meta, rt);
  }

  if (distEl){
    let ori = meta && meta.distrito_origen  ? meta.distrito_origen  : '';
    let des = meta && meta.distrito_destino ? meta.distrito_destino : '';
    if (direccion === 'vuelta'){
      [ori, des] = [des, ori];
    }
    distEl.textContent = (ori || des) ? `${ori} \u2192 ${des}` : '';
  }

  if (routeEl){
    routeEl.textContent = '';

    const from = stops && stops.from ? stops.from : '';
    const to   = stops && stops.to   ? stops.to   : '';

    if (from || to){
      routeEl.textContent = `${from} \u2192 ${to}`;
    } else if (rt && rt.name){
      let base = String(rt.name).trim();
      base = base.replace(/^\s*\d+\s*·\s*/, '');
      base = base.replace(/\s*\((ida|vuelta)\)\s*$/i, '');
      base = base.replace(/wikiroutes\s*\d*/ig, '').trim();
      if (base){
        routeEl.textContent = base;
      }
    }
  }
}

function makeWrDirPairControls(chk){
  const wrap = el('div',{class:'dir-mini'});
  const mk = (val,label) =>
    el('button',{class:`segbtn-mini${(chk.dataset.sel||'ida')===val?' active':''}`,'data-dir':val},label);
  const bIda = mk('ida','Ida');
  const bVta = mk('vuelta','Vuelta');
  wrap.append(bIda, bVta);

  wrap.addEventListener('click',(e)=>{
    const btn = e.target.closest('.segbtn-mini');
    if (!btn) return;
    const sel = btn.dataset.dir;
    if (!sel || sel === chk.dataset.sel) return;
    chk.dataset.sel = sel;
    [bIda,bVta].forEach(b=>b.classList.toggle('active', b===btn));

    const item = wrap.closest('.item');
    if (item){
      applyWrTextsToWrItem(item, sel);
    }

    if (chk.checked){
      const ida = chk.dataset.ida, vta = chk.dataset.vuelta;
      if (sel==='ida'){
        setWikiroutesVisible(ida, true, {fit:true});
        setWikiroutesVisible(vta, false);
      } else {
        setWikiroutesVisible(vta, true, {fit:true});
        setWikiroutesVisible(ida, false);
      }
    }
  });

  return wrap;
}

// Item para Wikiroutes
function makeWrItem(rt, metaByCodigo, routesById, extremes){
  const labelId = String(rt.id).toUpperCase();
  const tag = el('span',{ class:'tag', style:`background:${rt.color}` }, labelId);

  const textBlock = el('div',{},
    el('div',{class:'name wr-main-title'}, ''),
    el('div',{class:'sub wr-subtitle-dist'}, ''),
    el('div',{class:'sub wr-subtitle-route'}, '')
  );

  const left = el('div',{class:'left'}, tag, textBlock);

  // =========================
  // Normalizar pair ida/vuelta
  // =========================
  let idaRoute = null;
  let vtaRoute = null;
  let idaId = null;
  let vtaId = null;

  function normSide(side){
    let id = null;
    let route = null;
    if (!side) return {id, route};

    // Si es id directo
    if (typeof side === 'string' || typeof side === 'number'){
      id = String(side);
      route = routesById ? (routesById.get(id) || null) : null;
    } else if (typeof side === 'object'){
      if (side.id != null) id = String(side.id);
      // Si tenemos mapa de rutas, lo usamos; si no, usamos el propio objeto
      if (routesById && id){
        route = routesById.get(id) || side;
      } else {
        route = side;
      }
    }
    return {id, route};
  }

  if (rt.pair){
    const nIda = normSide(rt.pair.ida);
    const nVta = normSide(rt.pair.vuelta);
    idaId = nIda.id;
    idaRoute = nIda.route;
    vtaId = nVta.id;
    vtaRoute = nVta.route;

    // Ayuda para depurar si faltan IDs
    if (!idaId || !vtaId){
      console.warn('[WR] pair sin ambos IDs de ida/vuelta para ruta UI', rt);
    }
  }

  const hasBothDirs = !!(idaId && vtaId);

  const dataAttrs = hasBothDirs
    ? {
        'data-id': String(rt.id),
        'data-system': 'wr',
        'data-ida': idaId,
        'data-vuelta': vtaId,
        'data-sel': (rt.defaultDir || 'ida')
      }
    : {
        'data-id': String(rt.id),
        'data-system': 'wr'
      };

  const chk  = el('input', Object.assign({type:'checkbox', checked:false}, dataAttrs));
  const head = el('div',{class:'item-head'}, left, chk);
  const body = hasBothDirs
    ? el('div',{class:'item'}, head, makeWrDirPairControls(chk))
    : el('div',{class:'item'}, head);

  const key = wrCanonicalCode(rt.id);
  body.__wrMeta  = metaByCodigo ? (metaByCodigo[key] || null) : null;
  body.__wrRoute = rt;

  // =========================
  // Extremos Ida / Vuelta / default
  // =========================
  let stopsIda = null;
  let stopsVta = null;
  let stopsDefault = null;

  function computeStops(prefId, routeObj, dirKey){
    // 1) wr_extremes.json con el ID concreto
    if (prefId != null){
      const byId = wrStopsFromExtremesForRoute(String(prefId), extremes, dirKey);
      if (byId) return byId;
    }
    // 2) wr_extremes.json con el propio objeto (por si hubiese otro campo de id)
    if (routeObj){
      const byObj = wrStopsFromExtremesForRoute(routeObj, extremes, dirKey);
      if (byObj) return byObj;
    }
    // 3) Parseo "a pelo" del objeto/string
    return routeObj ? wrParseBaseStops(routeObj) : {from:'', to:'', label:''};
  }

  if (hasBothDirs){
    stopsIda = computeStops(idaId, idaRoute, 'ida');
    stopsVta = computeStops(vtaId, vtaRoute, 'vuelta');
  }

  if (!stopsIda && !stopsVta){
    // Fallback usando la propia ruta "agregada"
    stopsDefault =
      wrStopsFromExtremesForRoute(rt, extremes, 'ida') ||
      wrParseBaseStops(rt);
  } else {
    stopsDefault = stopsIda || stopsVta || null;
  }

  body.__wrStopsIda = stopsIda;
  body.__wrStopsVta = stopsVta;
  body.__wrStops    = stopsDefault;

  const initialDir = hasBothDirs ? (chk.dataset.sel || 'ida') : 'ida';
  applyWrTextsToWrItem(body, initialDir);

  // =========================
  // Checkbox principal
  // =========================
  chk.addEventListener('change', () => {
    if (hasBothDirs){
      const ida = chk.dataset.ida;
      const vta = chk.dataset.vuelta;
      const sel = chk.dataset.sel || 'ida';

      if (chk.checked){
        if (sel === 'ida'){
          setWikiroutesVisible(ida, true,  {fit:true});
          setWikiroutesVisible(vta, false);
        } else {
          setWikiroutesVisible(vta, true,  {fit:true});
          setWikiroutesVisible(ida, false);
        }
      } else {
        setWikiroutesVisible(ida, false);
        setWikiroutesVisible(vta, false);
      }
    } else {
      // Ruta sin par ida/vuelta: se comporta como antes
      if (chk.checked) setWikiroutesVisible(rt.id, true, {fit:true});
      else             setWikiroutesVisible(rt.id, false);
    }
    syncTriFromLeaf('wr');
  });

  return body;
}



function makeServiceItem(systemId, svc){
  if (systemId==='met')   return makeServiceItemMet(svc);
  if (systemId==='alim')  return makeServiceItemAlim(svc);
  if (systemId==='corr')  return makeServiceItemCorr(svc);
  if (systemId==='metro') return makeServiceItemMetro(svc);
  return document.createTextNode('');
}

/* =========================
   Construcción de listas
   ========================= */

export function fillMetList(){
  const sys = state.systems.met;
  sys.ui.listReg.innerHTML = '';
  sys.ui.listExp.innerHTML = '';
  const reg = sys.services.filter(s => s.kind === 'regular');
  const exp = sys.services.filter(s => s.kind === 'expreso');
  reg.forEach(s => sys.ui.listReg.appendChild(makeServiceItem('met', s)));
  exp.forEach(s => sys.ui.listExp.appendChild(makeServiceItem('met', s)));
}

export function fillAlimList(){
  const sys = state.systems.alim;
  sys.ui.listN.innerHTML = '';
  sys.ui.listS.innerHTML = '';
  sys.services.filter(s => s.zone === 'NORTE')
    .forEach(s => sys.ui.listN.appendChild(makeServiceItem('alim', s)));
  sys.services.filter(s => s.zone === 'SUR')
    .forEach(s => sys.ui.listS.appendChild(makeServiceItem('alim', s)));
}

// Corredores agrupados por color oficial (primer dígito)
function corridorGroupName(s){
  const code = String(s.id || '').trim();
  const first = code[0];
  switch (first){
    case '1': return 'Corredor Amarillo';
    case '2': return 'Corredor Rojo';
    case '3': return 'Corredor Azul';
    case '4': return 'Corredor Morado';
    case '5': return 'Corredor Verde';
    default:  return 'Otros';
  }
}
function keyFromGroupName(label){
  const k = label.toLowerCase();
  if (k.includes('amarillo')) return 'amarillo';
  if (k.includes('rojo'))     return 'rojo';
  if (k.includes('azul'))     return 'azul';
  if (k.includes('morado'))   return 'morado';
  if (k.includes('verde'))    return 'verde';
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
export function fillCorrList(){
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
  const order = [
    'Corredor Amarillo',
    'Corredor Rojo',
    'Corredor Azul',
    'Corredor Morado',
    'Corredor Verde',
    'Otros'
  ];
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

export function fillMetroList(){
  const sys = state.systems.metro;
  const list = sys.ui.list;
  if (!list) return;
  list.innerHTML = '';
  sys.services.forEach(s => list.appendChild(makeServiceItem('metro', s)));
}

export async function fillWrList(){
  const wr = state.systems.wr;
  const list = wr.ui.list;
  if (!list) return;
  list.innerHTML = '';

  const [metaByCodigo, extremes] = await Promise.all([
    loadWrListaMeta(),
    loadWrExtremes()
  ]);

  const allRoutes = Array.isArray(wr.routes) ? wr.routes : [];
  const routesById = new Map();
  allRoutes.forEach(r => {
    if (r && r.id != null) routesById.set(String(r.id), r);
  });

  const src = Array.isArray(wr.routesUi) && wr.routesUi.length ? wr.routesUi : wr.routes;
  (src || []).forEach(rt => list.appendChild(makeWrItem(rt, metaByCodigo, routesById, extremes)));
}

/* =========================
   Jerarquía / checks
   ========================= */

export function routeCheckboxesOf(systemId, groupChk=null){
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
      const panel = $(`#p-corr-${groupChk.dataset.group}`);
      return panel
        ? Array.from(panel.querySelectorAll('.item input[type=checkbox]'))
        : [];
    }
    return $$('#p-corr .item input[type=checkbox]');
  }
  if (systemId==='metro'){
    return $$('#p-metro .item input[type=checkbox]');
  }
  if (systemId==='wr'){
    return $$('#p-wr .item input[type=checkbox]');
  }
  return [];
}

export function setLeafChecked(systemId, leafChk, checked, {silentFit=false}={}){
  if (leafChk.checked === checked) return;
  leafChk.checked = checked;
  const id = leafChk.dataset.id;
  if (!id) return;

  if (systemId === 'wr') {
    const ida = leafChk.dataset.ida;
    const vta = leafChk.dataset.vuelta;
    if (ida && vta){
      const sel = leafChk.dataset.sel || 'ida';
      if (checked){
        if (sel==='ida'){ setWikiroutesVisible(ida, true, {fit:!silentFit}); setWikiroutesVisible(vta, false); }
        else            { setWikiroutesVisible(vta, true, {fit:!silentFit}); setWikiroutesVisible(ida, false); }
      } else {
        setWikiroutesVisible(ida, false);
        setWikiroutesVisible(vta, false);
      }
      return;
    }
    if (checked) setWikiroutesVisible(id, true, {fit:!silentFit});
    else setWikiroutesVisible(id, false);
  } else {
    onToggleService(systemId, id, checked, {silentFit});
  }
}

export function setLevel2Checked(systemId, groupChk, checked, {silentFit=false}={}){
  groupChk && (groupChk.checked = checked);
  groupChk && (groupChk.indeterminate = false);
  const leaves = routeCheckboxesOf(systemId, groupChk);
  leaves.forEach(ch => setLeafChecked(systemId, ch, checked, {silentFit}));
}

// Nivel 1 y 2
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

export function onLevel1ChangeCorr(){
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

export function onLevel1ChangeMetro(){
  const v = state.systems.metro.ui.chkAll.checked;
  bulk(()=> setLevel2Checked('metro', state.systems.metro.ui.chkAll, v, {silentFit:true}));
  syncAllTri();
}

export function onLevel1ChangeWr(){
  const v = state.systems.wr.ui.chkAll.checked;
  bulk(()=> setLevel2Checked('wr', state.systems.wr.ui.chkAll, v, {silentFit:true}));
  syncAllTri();
}

function syncTriOfGroup(systemId, groupChk){
  const leaves = routeCheckboxesOf(systemId, groupChk);
  const total = leaves.length;
  const checked = leaves.filter(c=>c.checked).length;
  groupChk && (groupChk.indeterminate = checked>0 && checked<total);
  groupChk && (groupChk.checked = total>0 && checked===total);
}

export function syncTriFromLeaf(systemId){
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
  } else if (systemId==='wr'){
    const top = state.systems.wr.ui.chkAll;
    const leaves = routeCheckboxesOf('wr');
    const total = leaves.length;
    const checked = leaves.filter(c=>c.checked).length;
    if (top){
      top.indeterminate = checked>0 && checked<total;
      top.checked = total>0 && checked===total;
    }
  }
}

export function syncAllTri(){
  ['met','alim','corr','metro','wr'].forEach(syncTriFromLeaf);
}

export function wireHierarchy(){
  state.systems.met.ui.chkAll.addEventListener('change', onLevel1ChangeMet);
  state.systems.met.ui.chkReg.addEventListener('change', ()=> onLevel2ChangeMet(state.systems.met.ui.chkReg));
  state.systems.met.ui.chkExp.addEventListener('change', ()=> onLevel2ChangeMet(state.systems.met.ui.chkExp));

  state.systems.alim.ui.chkAll.addEventListener('change', onLevel1ChangeAlim);
  state.systems.alim.ui.chkN  .addEventListener('change', ()=> onLevel2ChangeAlim(state.systems.alim.ui.chkN));
  state.systems.alim.ui.chkS  .addEventListener('change', ()=> onLevel2ChangeAlim(state.systems.alim.ui.chkS));

  state.systems.corr.ui.chkAll.addEventListener('change', onLevel1ChangeCorr);

  state.systems.metro.ui.chkAll.addEventListener('change', onLevel1ChangeMetro);

  state.systems.wr.ui.chkAll.addEventListener('change', onLevel1ChangeWr);

  syncAllTri();
}
