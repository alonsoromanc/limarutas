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

/* =========================
   Corredores: activos por Catalog o por Lista (switch)
   ========================= */

const CORR_ACTIVE_SOURCE = 'catalog'; // 'catalog' | 'lista'

const CORR_DIGIT_TO_KEY = {
  '1': 'amarillo',
  '2': 'rojo',
  '3': 'azul',
  '4': 'morado',
  '5': 'verde'
};

const CORR_KEY_LABEL = {
  amarillo: 'Corredor Amarillo',
  rojo: 'Corredor Rojo',
  azul: 'Corredor Azul',
  morado: 'Corredor Morado',
  verde: 'Corredor Verde',
  otros: 'Otros'
};

const CORR_KEY_COLOR = {
  amarillo: '#ffcd00',
  rojo: '#e4002b',
  azul: '#003594',
  morado: '#9b26b6',
  verde: '#8e8c13'
};

const CORR_GROUP_ORDER = ['amarillo','rojo','azul','morado','verde','otros'];

function lsGet(key){
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, val){
  try { localStorage.setItem(key, val); } catch {}
}

function corrGetMode(){
  return (CORR_ACTIVE_SOURCE === 'lista') ? 'lista' : 'catalog';
}

function corrSetMode(mode){
  lsSet(CORR_MODE_LS_KEY, mode === 'lista' ? 'lista' : 'catalog');
}

function corrGetCatalogCfg(){
  const cat = state.catalog || {};
  return cat.corredores || cat.corr || null;
}

function corrCanonical(value){
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return String(Number(s));
  return s.toUpperCase();
}

function corrBasesFor(codeRaw){
  let base = corrCanonical(codeRaw);
  base = base.replace(/-(IDA|VUELTA)$/i,'');
  const out = new Set();
  if (base) out.add(base);

  const m = base.match(/^(.+)_\d+$/);
  if (m && m[1]) out.add(m[1]);

  return Array.from(out);
}

function corrServiceCodeOf(svc){
  return String((svc && (svc.corrServicio || svc.id)) || '').trim();
}

function corrGetColorOverrides(){
  const cfg = corrGetCatalogCfg() || {};
  const raw =
    cfg.color_overrides ||
    cfg.colorOverrides ||
    {};

  const map = {};
  for (const [k, v] of Object.entries(raw || {})){
    const kk = String(k || '').toUpperCase().trim();
    if (!kk) continue;
    map[kk] = v;
  }
  return map;
}

function corrOverrideToGroupKey(v){
  if (!v) return null;

  if (typeof v === 'object'){
    const g = v.group || v.grupo || v.key || null;
    const gg = g ? String(g).trim().toLowerCase() : '';
    return CORR_KEY_COLOR[gg] ? gg : null;
  }

  if (typeof v === 'string'){
    const s = v.trim().toLowerCase();

    if (CORR_KEY_COLOR[s]) return s;

    if (s.startsWith('#')){
      for (const [k, hex] of Object.entries(CORR_KEY_COLOR)){
        if (hex.toLowerCase() === s) return k;
      }
    }
  }

  return null;
}

function corrOverrideToColor(v){
  if (!v) return null;

  if (typeof v === 'object'){
    const c = v.color || v.hex || null;
    if (c && typeof c === 'string' && c.trim().startsWith('#')) return c.trim();
    const g = corrOverrideToGroupKey(v);
    return g ? CORR_KEY_COLOR[g] : null;
  }

  if (typeof v === 'string'){
    const s = v.trim();
    if (s.startsWith('#')) return s;
    const g = corrOverrideToGroupKey(s);
    return g ? CORR_KEY_COLOR[g] : null;
  }

  return null;
}

function corrGroupKeyForCode(code){
  const s = String(code || '').trim().toUpperCase();
  if (!s) return 'otros';

  const ov = corrGetColorOverrides();
  const v = ov[s];

  const g = corrOverrideToGroupKey(v);
  if (g) return g;

  const first = s[0];
  return CORR_DIGIT_TO_KEY[first] || 'otros';
}

function corrColorForCode(code){
  const s = String(code || '').trim().toUpperCase();
  if (!s) return null;

  const ov = corrGetColorOverrides();
  const v = ov[s];

  const c = corrOverrideToColor(v);
  if (c) return c;

  const first = s[0];
  return CORR_COLORS[first] || null;
}

function corrFilterServicesByCatalog(services){
  const cfg = corrGetCatalogCfg();
  if (!cfg) return services || [];

  const upper = s => String(s).toUpperCase().trim();
  const onlySet = Array.isArray(cfg.only)
    ? new Set(cfg.only.map(corrCanonical).map(upper))
    : null;

  const excSet = Array.isArray(cfg.exclude)
    ? new Set(cfg.exclude.map(corrCanonical).map(upper))
    : new Set();

  return (services || []).filter(svc => {
    const code = corrServiceCodeOf(svc);
    const bases = corrBasesFor(code).map(upper);
    if (!bases.length) return false;

    if (bases.some(b => excSet.has(b))) return false;
    if (onlySet) return bases.some(b => onlySet.has(b));
    return true;
  });
}

/* ---- Lista alternativa: config/lista_corredores.json (opcional) ---- */

let corrListaPromise = null;
let corrListaCache = null;

function loadCorrListaCorredores(){
  if (corrListaPromise) return corrListaPromise;

  const url =
    (PATHS && PATHS.listas && PATHS.listas.corredores)
      ? PATHS.listas.corredores
      : 'config/lista_corredores.json';

  corrListaPromise = fetch(url)
    .then(r => (r.ok ? r.json() : null))
    .then(json => { corrListaCache = json; return json; })
    .catch(() => { corrListaCache = null; return null; });

  return corrListaPromise;
}

function corrListaAsSet(){
  const upper = s => String(s).toUpperCase().trim();
  const j = corrListaCache;

  let arr = null;
  if (Array.isArray(j)) arr = j;
  else if (j && Array.isArray(j.only)) arr = j.only;
  else if (j && Array.isArray(j.activos)) arr = j.activos;
  else if (j && j.corredores && Array.isArray(j.corredores.only)) arr = j.corredores.only;

  if (!arr) return null;
  return new Set(arr.map(corrCanonical).map(upper));
}

function corrFilterServicesByLista(services){
  const set = corrListaAsSet();
  if (!set) return services || [];

  const upper = s => String(s).toUpperCase().trim();
  return (services || []).filter(svc => {
    const code = corrServiceCodeOf(svc);
    const bases = corrBasesFor(code).map(upper);
    return bases.some(b => set.has(b));
  });
}

function makeCorrSourceToggle(){
  const mode = corrGetMode();
  const wrap = el('div',{class:'dir-mini', style:'margin:6px 0;'});
  const mk = (val, label, title) =>
    el('button', { class:`segbtn-mini${mode===val?' active':''}`, 'data-src':val, title }, label);

  wrap.append(
    mk('catalog','Catalog','Activos según config/catalog.json'),
    mk('lista','Lista','Activos según config/lista_corredores.json')
  );

  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.segbtn-mini');
    if (!b) return;

    const next = b.dataset.src;
    if (!next || next === corrGetMode()) return;

    corrSetMode(next);

    if (next === 'lista' && !corrListaCache){
      loadCorrListaCorredores().finally(() => { fillCorrList(); syncAllTri(); });
      return;
    }

    fillCorrList();
    syncAllTri();
  });

  return wrap;
}

/* Alias por compatibilidad con tu código */
function corrColorForId(id){
  return corrColorForCode(id);
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

/* =============== Helpers para items tipo Ida/Vuelta (Corredores y WR) =============== */

function wrParseBaseStops(source){
  if (!source) return {from:'', to:'', label:''};

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

  const props = source;
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

  if (Array.isArray(props.stops) && props.stops.length){
    const first = props.stops[0];
    const last  = props.stops[props.stops.length - 1];
    const getName = st => {
      if (!st) return '';
      return (st.name || st.title || st.label || '');
    };
    const from = String(getName(first) || '').trim();
    const to   = String(getName(last) || '').trim();
    const label = (from || to) ? `${from} \u2192 ${to}` : '';
    return {from, to, label};
  }

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

function normPairId(side){
  if (!side) return null;
  if (typeof side === 'string' || typeof side === 'number') return String(side);
  if (typeof side === 'object'){
    if (side.id != null) return String(side.id);
    if (side.route_id != null) return String(side.route_id);
    if (side.routeId != null) return String(side.routeId);
  }
  return null;
}

/* =========================
   Corredores desde corrWr (Ida/Vuelta como Wikiroutes)
   ========================= */

function applyCorrTextsToItem(item, direccion){
  const svc = item.__corrSvc || null;
  if (!svc) return;

  const titleEl = item.querySelector('.corr-main-title');
  const odEl    = item.querySelector('.corr-subtitle-od');
  const extraEl = item.querySelector('.corr-subtitle-extra');

  const servicio = String(svc.corrServicio || svc.id || '').trim();

  if (titleEl){
    titleEl.textContent = servicio ? `Servicio ${servicio}` : 'Servicio';
  }

  let ori = (svc.corrOrigen != null ? String(svc.corrOrigen).trim() : '');
  let des = (svc.corrDestino != null ? String(svc.corrDestino).trim() : '');

  if (!(ori || des)){
    const parsed = wrParseBaseStops(svc.name || svc.title || '');
    ori = parsed.from || '';
    des = parsed.to || '';
  }

  if (direccion === 'vuelta'){
    [ori, des] = [des, ori];
  }

  if (odEl){
    odEl.textContent = (ori || des) ? `${ori} \u2192 ${des}` : (svc.name || '');
  }

  if (extraEl){
    extraEl.textContent = '';
  }
}

function toggleCorrPair(chk, checked, {silentFit=false}={}){
  const ida = chk.dataset.ida;
  const vta = chk.dataset.vuelta;
  if (!ida || !vta) return;

  const sel = chk.dataset.sel || 'ida';
  if (checked){
    if (sel === 'ida'){
      setWikiroutesVisible(ida, true,  {fit:!silentFit});
      setWikiroutesVisible(vta, false);
    } else {
      setWikiroutesVisible(vta, true,  {fit:!silentFit});
      setWikiroutesVisible(ida, false);
    }
  } else {
    setWikiroutesVisible(ida, false);
    setWikiroutesVisible(vta, false);
  }
}

function makeCorrDirPairControls(chk){
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
      applyCorrTextsToItem(item, sel);
    }

    if (chk.checked){
      if (sel==='ida'){
        setWikiroutesVisible(chk.dataset.ida, true, {fit:true});
        setWikiroutesVisible(chk.dataset.vuelta, false);
      } else {
        setWikiroutesVisible(chk.dataset.vuelta, true, {fit:true});
        setWikiroutesVisible(chk.dataset.ida, false);
      }
    }
  });

  return wrap;
}

function makeServiceItemCorr(svc){
  const servicio = String(svc.corrServicio || svc.id || '').trim();
  const code = servicio || String(svc.id || '').trim();

  const color = corrColorForCode(code) || svc.corrColor || svc.color || '#10b981';

  const tag = el('span',{class:'tag', style:`background:${color}`}, code || 'Corr');

  const textBlock = el('div',{},
    el('div',{class:'name corr-main-title'}, ''),
    el('div',{class:'sub corr-subtitle-od'}, ''),
    el('div',{class:'sub corr-subtitle-extra'}, '')
  );

  const left = el('div',{class:'left'}, tag, textBlock);

  let idaId = null;
  let vtaId = null;

  if (svc.pair){
    idaId = normPairId(svc.pair.ida);
    vtaId = normPairId(svc.pair.vuelta);
  } else if (svc.ida && svc.vuelta){
    idaId = normPairId(svc.ida);
    vtaId = normPairId(svc.vuelta);
  }

  const hasBothDirs = !!(idaId && vtaId);

  const dataAttrs = hasBothDirs
    ? {
        'data-id': String(svc.id),
        'data-system': 'corr',
        'data-ida': idaId,
        'data-vuelta': vtaId,
        'data-sel': (svc.defaultDir || 'ida')
      }
    : {
        'data-id': String(svc.id),
        'data-system': 'corr'
      };

  const chk  = el('input', Object.assign({type:'checkbox','data-system':'corr'}, dataAttrs));
  const head = el('div',{class:'item-head'}, left, chk);

  const body = hasBothDirs
    ? el('div',{class:'item'}, head, makeCorrDirPairControls(chk))
    : el('div',{class:'item'}, head);

  body.__corrSvc = svc;

  const initialDir = hasBothDirs ? (chk.dataset.sel || 'ida') : 'ida';
  applyCorrTextsToItem(body, initialDir);

  chk.addEventListener('change', () => {
    if (hasBothDirs){
      toggleCorrPair(chk, chk.checked, {silentFit:false});
    } else {
      const id = chk.dataset.id;
      if (id && /^\d+$/.test(String(id))){
        if (chk.checked) setWikiroutesVisible(id, true, {fit:true});
        else setWikiroutesVisible(id, false);
      } else {
        onToggleService('corr', svc.id, chk.checked);
      }
    }
    syncTriFromLeaf('corr');
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

/* ---- Filtrado por grupo usando catalog.json ---- */

function wrFilterRoutesByGroup(groupName, routes){
  const catalog = state.catalog || {};
  const upper = s => String(s).toUpperCase().trim();

  let cfg = null;
  if (groupName === 'transporte'){
    cfg = catalog.transporte || null;
  } else if (groupName === 'aerodirecto'){
    cfg = catalog.aerodirecto || null;
  } else if (groupName === 'expreso_san_isidro'){
    cfg = (catalog.otros && catalog.otros.expreso_san_isidro) || null;
  } else {
    return routes || [];
  }

  if (!cfg) return routes || [];

  const only = Array.isArray(cfg.only) ? new Set(cfg.only.map(upper)) : null;
  const exc  = Array.isArray(cfg.exclude) ? new Set(cfg.exclude.map(upper)) : new Set();

  const basesFor = (idRaw) => {
    let base = upper(idRaw || '');
    const mTrip = base.match(/^(.*?)-(IDA|VUELTA)$/i);
    if (mTrip) base = mTrip[1];

    const out = new Set();
    if (base) out.add(base);

    const m = base.match(/^(.+)_\d+$/);
    if (m && m[1]) out.add(m[1]);

    if (/^\d+$/.test(base)) out.add(String(Number(base)));

    return Array.from(out);
  };

  return (routes || []).filter(rt => {
    const bases = basesFor(rt && rt.id != null ? rt.id : '');
    if (!bases.length) return false;

    if (bases.some(b => exc.has(b))) return false;
    if (only) return bases.some(b => only.has(b));
    return true;
  });
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

// Usa wr_extremes.json para obtener extremos si hay match
function wrStopsFromExtremesForRoute(routeLike, extremes, dirKey){
  if (!routeLike || !extremes) return null;

  const candidates = [];

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
function makeWrItem(rt, metaByCodigo, routesById, extremes, systemId='wr'){
  const labelId = String(rt.id).toUpperCase();
  const tagColor = rt && rt.color ? rt.color : '#64748b';
  const tag = el('span',{ class:'tag', style:`background:${tagColor}` }, labelId);

  const textBlock = el('div',{},
    el('div',{class:'name wr-main-title'}, ''),
    el('div',{class:'sub wr-subtitle-dist'}, ''),
    el('div',{class:'sub wr-subtitle-route'}, '')
  );

  const left = el('div',{class:'left'}, tag, textBlock);

  let idaRoute = null;
  let vtaRoute = null;
  let idaId = null;
  let vtaId = null;

  function normSide(side){
    let id = null;
    let route = null;
    if (!side) return {id, route};

    if (typeof side === 'string' || typeof side === 'number'){
      id = String(side);
      route = routesById ? (routesById.get(id) || null) : null;
    } else if (typeof side === 'object'){
      if (side.id != null) id = String(side.id);
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

    if (!idaId || !vtaId){
      console.warn('[WR] pair sin ambos IDs de ida/vuelta para ruta UI', rt);
    }
  }

  const hasBothDirs = !!(idaId && vtaId);

  const dataAttrs = hasBothDirs
    ? {
        'data-id': String(rt.id),
        'data-system': systemId,
        'data-ida': idaId,
        'data-vuelta': vtaId,
        'data-sel': (rt.defaultDir || 'ida')
      }
    : {
        'data-id': String(rt.id),
        'data-system': systemId
      };

  const chk  = el('input', Object.assign({type:'checkbox', checked:false}, dataAttrs));
  const head = el('div',{class:'item-head'}, left, chk);
  const body = hasBothDirs
    ? el('div',{class:'item'}, head, makeWrDirPairControls(chk))
    : el('div',{class:'item'}, head);

  const key = wrCanonicalCode(rt.id);
  body.__wrMeta  = metaByCodigo ? (metaByCodigo[key] || null) : null;
  body.__wrRoute = rt;

  let stopsIda = null;
  let stopsVta = null;
  let stopsDefault = null;

  function computeStops(prefId, routeObj, dirKey){
    if (prefId != null){
      const byId = wrStopsFromExtremesForRoute(String(prefId), extremes, dirKey);
      if (byId) return byId;
    }
    if (routeObj){
      const byObj = wrStopsFromExtremesForRoute(routeObj, extremes, dirKey);
      if (byObj) return byObj;
    }
    return routeObj ? wrParseBaseStops(routeObj) : {from:'', to:'', label:''};
  }

  if (hasBothDirs){
    stopsIda = computeStops(idaId, idaRoute, 'ida');
    stopsVta = computeStops(vtaId, vtaRoute, 'vuelta');
  }

  if (!stopsIda && !stopsVta){
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
      if (chk.checked) setWikiroutesVisible(rt.id, true, {fit:true});
      else             setWikiroutesVisible(rt.id, false);
    }
    syncTriFromLeaf(systemId);
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

  const baseSrc = (state.corrWr && Array.isArray(state.corrWr.services) && state.corrWr.services.length)
    ? state.corrWr.services
    : sys.services;

  let services = (baseSrc || []).filter(s => {
    if (!s) return false;
    if (s.corrActiva == null) return true;
    return !!s.corrActiva;
  });

  const mode = corrGetMode();

  if (mode === 'catalog'){
    services = corrFilterServicesByCatalog(services);
  } else {
    if (!corrListaCache){
      loadCorrListaCorredores().finally(() => { fillCorrList(); syncAllTri(); });
      return; // importante: evita render incompleto mientras carga
    }
    services = corrFilterServicesByLista(services);
  }

  if (!services.length){
    empty && (empty.style.display = 'block');
    sys.ui.chkAll && (sys.ui.chkAll.disabled = true);
    return;
  }

  empty && (empty.style.display = 'none');
  sys.ui.chkAll && (sys.ui.chkAll.disabled = false);

  const groups = new Map();
  services.forEach(s => {
    const code = corrServiceCodeOf(s);
    const key = corrGroupKeyForCode(code);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });

  CORR_GROUP_ORDER.forEach(key => {
    const arr = groups.get(key);
    if (!arr || !arr.length) return;

    const label = CORR_KEY_LABEL[key] || 'Otros';
    buildCorrGroupSection(container, key, label);

    const grp = state.systems.corr.ui.groups.get(key);
    arr.forEach(svc => grp.body.appendChild(makeServiceItem('corr', svc)));
  });
}

export function fillMetroList(){
  const sys = state.systems.metro;
  const list = sys.ui.list;
  if (!list) return;
  list.innerHTML = '';
  sys.services.forEach(s => list.appendChild(makeServiceItem('metro', s)));
}

/* =========================
   Wikiroutes: listas por grupo
   ========================= */

async function fillWrGroup(list, groupName, systemIdForItems){
  if (!list) return;
  list.innerHTML = '';

  const [metaByCodigo, extremes] = await Promise.all([
    loadWrListaMeta(),
    loadWrExtremes()
  ]);

  const wr = state.systems.wr;
  const allRoutes = Array.isArray(wr.routes) ? wr.routes : [];
  const routesById = new Map();
  allRoutes.forEach(r => {
    if (r && r.id != null) routesById.set(String(r.id), r);
  });

  const srcBase = (Array.isArray(wr.routesUi) && wr.routesUi.length) ? wr.routesUi : allRoutes;
  const src = wrFilterRoutesByGroup(groupName, srcBase);

  (src || []).forEach(rt =>
    list.appendChild(makeWrItem(rt, metaByCodigo, routesById, extremes, systemIdForItems))
  );
}

export async function fillWrList(){
  const wr = state.systems.wr;
  await fillWrGroup(wr.ui.list, 'transporte', 'wr');
}

export async function fillAeroList(){
  const wr = state.systems.wr;
  await fillWrGroup(wr.ui.listAero, 'aerodirecto', 'wrAero');
}

export async function fillOtrosList(){
  const wr = state.systems.wr;
  await fillWrGroup(wr.ui.listOtros, 'expreso_san_isidro', 'wrOtros');
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
    return $$('#p-corr-list .item input[type=checkbox]');
  }
  if (systemId==='metro'){
    return $$('#p-metro .item input[type=checkbox]');
  }
  if (systemId==='wr'){
    return $$('#p-wr .item input[type=checkbox]');
  }
  if (systemId==='wrAero'){
    return $$('#p-wr-aero .item input[type=checkbox]');
  }
  if (systemId==='wrOtros'){
    return $$('#p-wr-otros .item input[type=checkbox]');
  }
  return [];
}

export function setLeafChecked(systemId, leafChk, checked, {silentFit=false}={}){
  if (leafChk.checked === checked) return;
  leafChk.checked = checked;
  const id = leafChk.dataset.id;
  if (!id) return;

  // Corredores: si viene como par ida/vuelta (corrWr), togglear como WR
  if (systemId === 'corr'){
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
  }

  if (systemId === 'wr' || systemId === 'wrAero' || systemId === 'wrOtros') {
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

export function onLevel1ChangeWrAero(){
  const ui = state.systems.wr.ui;
  if (!ui.chkAero) return;
  const v = ui.chkAero.checked;
  bulk(()=> setLevel2Checked('wrAero', ui.chkAero, v, {silentFit:true}));
  syncAllTri();
}

export function onLevel1ChangeWrOtros(){
  const ui = state.systems.wr.ui;
  if (!ui.chkOtros) return;
  const v = ui.chkOtros.checked;
  bulk(()=> setLevel2Checked('wrOtros', ui.chkOtros, v, {silentFit:true}));
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
  } else if (systemId==='wrAero'){
    const top = state.systems.wr.ui.chkAero;
    if (!top) return;
    const leaves = routeCheckboxesOf('wrAero');
    const total = leaves.length;
    const checked = leaves.filter(c=>c.checked).length;
    top.indeterminate = checked>0 && checked<total;
    top.checked = total>0 && checked===total;
  } else if (systemId==='wrOtros'){
    const top = state.systems.wr.ui.chkOtros;
    if (!top) return;
    const leaves = routeCheckboxesOf('wrOtros');
    const total = leaves.length;
    const checked = leaves.filter(c=>c.checked).length;
    top.indeterminate = checked>0 && checked<total;
    top.checked = total>0 && checked===total;
  }
}

export function syncAllTri(){
  ['met','alim','corr','metro','wr','wrAero','wrOtros'].forEach(syncTriFromLeaf);
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

  if (state.systems.wr.ui.chkAero){
    state.systems.wr.ui.chkAero.addEventListener('change', onLevel1ChangeWrAero);
  }
  if (state.systems.wr.ui.chkOtros){
    state.systems.wr.ui.chkOtros.addEventListener('change', onLevel1ChangeWrOtros);
  }

  syncAllTri();
}
