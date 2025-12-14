// uiSidebar.corr.js
import { PATHS, state } from './config.js';
import { $, el } from './utils.js';
import { makeServiceItem } from './uiSidebar.items.js';
import { onLevel2ChangeCorr, onLevel3ChangeCorr, syncAllTri } from './uiSidebar.hierarchy.js';

/* =========================
   Corredores: colores y grupos
   ========================= */

// Colores oficiales para corredores según primer dígito del servicio
const CORR_COLORS = {
  '1': '#ffcd00', // Amarillo
  '2': '#e4002b', // Rojo
  '3': '#003594', // Azul
  '4': '#9b26b6', // Morado
  '5': '#8e8c13'  // Verde
};

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

/* =========================
   Tipos (Principales vs Alimentadores)
   =========================
   Intenta leer de config/lista_corredores.json (si trae esa info).
   Si no existe o no trae estructura, usa heurística numérica:
   150-199, 250-299, 350-399, 450-499, 550-599 => Alimentadores.
*/
let corrTiposPromise = null;
let corrTiposCache = { principales: null, alimentadores: null };

/* =========================
   Helpers Corr
   ========================= */
function corrGetCatalogCfg(){
  const cat = state.catalog || {};
  return cat.corredores || cat.corr || null;
}

export function corrCanonical(value){
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return String(Number(s));
  return s.toUpperCase();
}

export function corrServiceCodeOf(svc){
  return String((svc && (svc.corrServicio || svc.id)) || '').trim();
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

function corrGetColorOverrides(){
  const cfg = corrGetCatalogCfg() || {};
  const raw = cfg.color_overrides || cfg.colorOverrides || {};
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

/* Casos especiales (porque no arrancan con dígito) */
function corrSpecialGroupKey(codeUpper){
  const raw = String(codeUpper || '').trim().toUpperCase();
  if (!raw) return null;

  const compact = raw.replace(/[\s_-]+/g, '');

  // COLE BUS debe ir a Azul
  if (compact === 'COLEBUS') return 'azul';

  // SE-02 y SP-01 deben ir a Morado
  if (/^SE0?2$/.test(compact)) return 'morado';
  if (/^SP0?1$/.test(compact)) return 'morado';

  return null;
}

export function corrGroupKeyForCode(code){
  const s = String(code || '').trim().toUpperCase();
  if (!s) return 'otros';

  const ov = corrGetColorOverrides();
  const v = ov[s];
  const gOv = corrOverrideToGroupKey(v);
  if (gOv) return gOv;

  const gSp = corrSpecialGroupKey(s);
  if (gSp) return gSp;

  const first = s[0];
  return CORR_DIGIT_TO_KEY[first] || 'otros';
}

export function corrColorForCode(code){
  const s = String(code || '').trim().toUpperCase();
  if (!s) return null;

  const ov = corrGetColorOverrides();
  const v = ov[s];
  const cOv = corrOverrideToColor(v);
  if (cOv) return cOv;

  const gSp = corrSpecialGroupKey(s);
  if (gSp) return CORR_KEY_COLOR[gSp] || null;

  const first = s[0];
  return CORR_COLORS[first] || null;
}

// Alias por compatibilidad si lo usas en otros módulos
export function corrColorForId(id){
  return corrColorForCode(id);
}

export function corrFilterServicesByCatalog(services){
  const cfg = corrGetCatalogCfg();
  if (!cfg) return services || [];

  const upper = x => String(x).toUpperCase().trim();

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

/* =========================
   Tipos: cargar y resolver alimentador
   ========================= */
function corrPickArray(node){
  if (!node) return null;
  if (Array.isArray(node)) return node;
  if (node && typeof node === 'object'){
    if (Array.isArray(node.only)) return node.only;
    if (Array.isArray(node.items)) return node.items;
    if (Array.isArray(node.codigos)) return node.codigos;
    if (Array.isArray(node.activos)) return node.activos;
  }
  return null;
}

function corrParseTipos(json){
  const upper = x => String(x).toUpperCase().trim();

  const root =
    (json && (json.corredores || json.corr)) ||
    json ||
    {};

  const pNode =
    root.principales || root.principal ||
    (root.tipos && (root.tipos.principales || root.tipos.principal)) ||
    (json && (json.principales || json.principal)) ||
    null;

  const aNode =
    root.alimentadores || root.alimentador ||
    (root.tipos && (root.tipos.alimentadores || root.tipos.alimentador)) ||
    (json && (json.alimentadores || json.alimentador)) ||
    null;

  const pArr = corrPickArray(pNode);
  const aArr = corrPickArray(aNode);

  const principales = pArr ? new Set(pArr.map(corrCanonical).map(upper)) : null;
  const alimentadores = aArr ? new Set(aArr.map(corrCanonical).map(upper)) : null;

  return { principales, alimentadores };
}

function loadCorrTipos(){
  if (corrTiposPromise) return corrTiposPromise;

  const url =
    (PATHS && PATHS.listas && (PATHS.listas.corredores_tipos || PATHS.listas.corredoresTipos))
      ? (PATHS.listas.corredores_tipos || PATHS.listas.corredoresTipos)
      : 'config/lista_corredores.json';

  corrTiposPromise = fetch(url)
    .then(r => (r.ok ? r.json() : null))
    .then(json => {
      if (!json) return { principales: null, alimentadores: null };
      const parsed = corrParseTipos(json);
      corrTiposCache = parsed;
      return parsed;
    })
    .catch(() => {
      corrTiposCache = { principales: null, alimentadores: null };
      return corrTiposCache;
    });

  return corrTiposPromise;
}

function corrIsAlimentadorByHeuristic(code){
  const s = corrCanonical(code);
  if (!/^\d+$/.test(s)) return false;

  const n = Number(s);
  if (!Number.isFinite(n)) return false;

  const inRange = (a, b) => n >= a && n <= b;

  return (
    inRange(150, 199) ||
    inRange(250, 299) ||
    inRange(350, 399) ||
    inRange(450, 499) ||
    inRange(550, 599)
  );
}

export function corrIsAlimentador(code){
  const upper = x => String(x).toUpperCase().trim();
  const c = upper(corrCanonical(code));

  if (corrTiposCache && corrTiposCache.alimentadores && corrTiposCache.alimentadores.has(c)) return true;
  if (corrTiposCache && corrTiposCache.principales && corrTiposCache.principales.has(c)) return false;

  return corrIsAlimentadorByHeuristic(code);
}

export function corrSortServices(arr){
  const canonUpper = (svc) => String(corrCanonical(corrServiceCodeOf(svc))).toUpperCase().trim();

  const keyOf = (svc) => {
    const s = canonUpper(svc);
    if (/^\d+$/.test(s)) return { t: 0, n: Number(s), s };
    return { t: 1, n: 0, s };
  };

  return (arr || []).sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka.t !== kb.t) return ka.t - kb.t;
    if (ka.t === 0 && ka.n !== kb.n) return ka.n - kb.n;
    return ka.s.localeCompare(kb.s);
  });
}

/* =========================
   UI builders: grupo (color) y pestañas (P/A)
   ========================= */
function buildCorrGroupSection(container, key, label){
  const secId = `p-corr-${key}`;
  const chkId = `chk-corr-${key}`;

  const section = el('section',{class:'panel nested'});
  const head = el('button',{class:'panel-head','data-target':secId,'aria-expanded':'false'},
    el('span',{class:'chev'},'▸'),
    el('span',{class:'title'},label),
    el('input',{type:'checkbox',id:chkId,class:'right','data-group':key})
  );

  // Ojo: sin "list" aquí porque adentro van pestañas como paneles
  const body = el('div',{id:secId,class:'panel-body'});

  section.append(head, body);
  container.appendChild(section);

  const chk = head.querySelector('input[type="checkbox"]');

  const entry = { chk, body, tabs: new Map() };
  const sys = state.systems.corr;
  if (!sys.ui.groups || !(sys.ui.groups instanceof Map)) sys.ui.groups = new Map();
  sys.ui.groups.set(key, entry);

  chk.addEventListener('change', () => onLevel2ChangeCorr(chk));
}

function buildCorrTabSection(parentBody, groupKey, tabKey, label){
  const secId = `p-corr-${groupKey}-${tabKey}`;
  const chkId = `chk-corr-${groupKey}-${tabKey}`;

  const section = el('section',{class:'panel nested'});
  const head = el('button',{class:'panel-head','data-target':secId,'aria-expanded':'false'},
    el('span',{class:'chev'},'▸'),
    el('span',{class:'title'},label),
    el('input',{type:'checkbox',id:chkId,class:'right','data-group':groupKey,'data-sub':tabKey})
  );
  const body = el('div',{id:secId,class:'panel-body list'});

  section.append(head, body);
  parentBody.appendChild(section);

  const chk = head.querySelector('input[type="checkbox"]');
  chk.addEventListener('change', () => onLevel3ChangeCorr(chk));

  return { chk, body };
}

/* =========================
   Fill Corr List
   ========================= */
export function fillCorrList(){
  const sys = state.systems.corr;
  const container = sys.ui.list;
  const empty = $('#p-corr-empty');

  if (!container) return;

  container.innerHTML = '';

  if (!sys.ui.groups || !(sys.ui.groups instanceof Map)) sys.ui.groups = new Map();
  sys.ui.groups.clear();

  // Disparar carga de tipos (si existe) y refrescar al terminar
  if (!corrTiposPromise){
    loadCorrTipos().finally(() => {
      fillCorrList();
      syncAllTri();
    });
  }

  const baseSrc = (state.corrWr && Array.isArray(state.corrWr.services) && state.corrWr.services.length)
    ? state.corrWr.services
    : sys.services;

  // No distinguir activa/inactiva
  let services = (baseSrc || []).filter(s => !!s);

  // Filtrado por catalog.json (only/exclude)
  services = corrFilterServicesByCatalog(services);

  if (!services.length){
    if (empty) empty.style.display = 'block';
    if (sys.ui.chkAll) sys.ui.chkAll.disabled = true;
    return;
  }

  if (empty) empty.style.display = 'none';
  if (sys.ui.chkAll) sys.ui.chkAll.disabled = false;

  // Agrupar por color
  const groups = new Map();
  services.forEach(s => {
    const code = corrServiceCodeOf(s);
    const key = corrGroupKeyForCode(code);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });

  // Construir en orden y omitir "Otros" si queda vacío (y cualquier grupo vacío)
  CORR_GROUP_ORDER.forEach(key => {
    const arr = groups.get(key);
    if (!arr || !arr.length) return;

    const label = CORR_KEY_LABEL[key] || 'Otros';
    buildCorrGroupSection(container, key, label);

    const grp = sys.ui.groups.get(key);

    const principales = [];
    const alimentadores = [];

    arr.forEach(svc => {
      const code = corrServiceCodeOf(svc);
      if (corrIsAlimentador(code)) alimentadores.push(svc);
      else principales.push(svc);
    });

    corrSortServices(principales);
    corrSortServices(alimentadores);

    // Pestañas estilo "Metropolitano": paneles anidados con checkbox
    if (principales.length){
      const tab = buildCorrTabSection(grp.body, key, 'p', 'Principales');
      grp.tabs.set('p', tab);
      principales.forEach(svc => tab.body.appendChild(makeServiceItem('corr', svc)));
    }

    if (alimentadores.length){
      const tab = buildCorrTabSection(grp.body, key, 'a', 'Alimentadores');
      grp.tabs.set('a', tab);
      alimentadores.forEach(svc => tab.body.appendChild(makeServiceItem('corr', svc)));
    }
  });
}
