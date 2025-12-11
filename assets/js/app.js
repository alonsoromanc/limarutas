import { PATHS, state } from './config.js';
import { $, $$, fetchJSON, stopsArrayToMap, asLatLng } from './utils.js';
import {
  filterByCatalogFor,
  buildAlimFromFC,
  buildCorredoresFromFC,
  buildMetroFromJSON
} from './parsers.js';
import {
  initMap,
  reRenderVisibleSystem,
  reRenderVisible,
  setBase
} from './mapLayers.js';
import {
  fillMetList,
  fillAlimList,
  fillCorrList,
  fillMetroList,
  fillWrList,
  wireHierarchy,
  setLevel2Checked,
  bulk,
  onLevel1ChangeCorr,
  onLevel1ChangeMetro,
  onLevel1ChangeWr,
  syncAllTri
} from './uiSidebar.js';
import { wirePanelTogglesOnce } from './panels.js';
import { setupSearch } from './search.js';

/* ===========================
   Helpers UI de carga
   =========================== */

function setStatus(text){
  const statusEl = $('#status');
  if (statusEl) statusEl.textContent = text;
}

function ensureSidebarOverlay(){
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return null;

  // NO pisar el layout del sidebar: solo si computed position es "static"
  // (en muchos layouts el sidebar es fixed/absolute por CSS; eso NO debe cambiarse).
  const cs = window.getComputedStyle(sidebar);
  if (cs.position === 'static' && sidebar.dataset._posFixApplied !== '1') {
    sidebar.dataset._posFixApplied = '1';
    sidebar.style.position = 'relative';
  }

  let ov = document.getElementById('sidebarLoading');
  if (!ov){
    ov = document.createElement('div');
    ov.id = 'sidebarLoading';
    ov.style.position = 'absolute';
    ov.style.inset = '0';
    ov.style.background = 'rgba(0,0,0,0.25)';
    ov.style.backdropFilter = 'blur(2px)';
    ov.style.zIndex = '9999';
    ov.style.display = 'none';
    ov.style.alignItems = 'center';
    ov.style.justifyContent = 'center';
    ov.style.padding = '16px';

    // Importante: que NO bloquee el scroll del contenedor
    ov.style.pointerEvents = 'none';

    sidebar.appendChild(ov);
  }

  return ov;
}

function setSidebarLoading(on, msg){
  const sidebar = document.getElementById('sidebar');
  const ov = ensureSidebarOverlay();
  if (!sidebar || !ov) return;

  if (on){
    ov.innerHTML =
      `<div style="background: rgba(15,15,15,0.75); color: #fff; padding: 12px 14px; border-radius: 10px; max-width: 360px; line-height: 1.25;">
        <div style="font-weight: 700; margin-bottom: 6px;">Cargando</div>
        <div style="opacity: 0.95;">${msg || 'Preparando rutas y paraderos...'}</div>
      </div>`;
    ov.style.display = 'flex';
  } else {
    ov.style.display = 'none';
    ov.innerHTML = '';

    // Revertir el fix SOLO si lo aplicamos nosotros
    if (sidebar.dataset._posFixApplied === '1') {
      delete sidebar.dataset._posFixApplied;
      sidebar.style.position = '';
    }
  }
}

function setListPlaceholder(el, text){
  if (!el) return;
  el.innerHTML = `<div style="opacity:0.75; font-size: 12px; padding: 8px 6px;">${text}</div>`;
}

function disableSidebarChecks(disabled){
  const ids = [
    'chk-met','chk-met-reg','chk-met-exp',
    'chk-met-alim','chk-met-alim-n','chk-met-alim-s',
    'chk-corr','chk-metro','chk-wr'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!disabled;
  });
}

function nextFrame(){
  return new Promise(res => requestAnimationFrame(() => res()));
}

/* ===========================
   Helpers Macrorutas Metropolitano
   =========================== */

// south = norte a sur, north = sur a norte
async function loadMetMacroSegments(macroId, suffix){
  const path = `${PATHS.met}/trayectos-macro/${macroId}-${suffix}.geojson`;
  try {
    const gj = await fetchJSON(path);
    if (!gj || gj.type !== 'FeatureCollection') {
      console.warn('[Met macro]', macroId, suffix, 'no es FeatureCollection');
      return null;
    }
    const segments = [];
    (gj.features || []).forEach(f => {
      const g = f.geometry;
      if (!g || g.type !== 'LineString' || !Array.isArray(g.coordinates)) return;
      const seg = g.coordinates.map(asLatLng); // [lon,lat] -> [lat,lon]
      if (seg.length >= 2) segments.push(seg);
    });
    if (!segments.length) return null;
    return segments;
  } catch (e) {
    console.warn('[Met macro] No se pudo cargar', path, e.message);
    return null;
  }
}

async function loadMetMacros(){
  state.systems.met.macros = {};

  const macroIds = ['A', 'B'];
  for (const mid of macroIds) {
    const northSouth = await loadMetMacroSegments(mid, 'south'); // norte a sur
    const southNorth = await loadMetMacroSegments(mid, 'north'); // sur a norte
    if (northSouth || southNorth) {
      state.systems.met.macros[mid] = {};
      if (northSouth) state.systems.met.macros[mid].north_south = northSouth;
      if (southNorth) state.systems.met.macros[mid].south_north = southNorth;
    }
  }
  console.log('[Met macro] Macros disponibles:', Object.keys(state.systems.met.macros).join(', ') || '(ninguna)');
}

/* ===========================
   Loaders por sistema
   =========================== */

async function loadCatalog(){
  try {
    state.catalog = await fetchJSON(`config/catalog.json`);
    console.log('[Catálogo] Usando config/catalog.json');
    return;
  } catch {}

  state.catalog = await fetchJSON(`${PATHS.data}/catalog.json`).catch(()=>null);
  console.log('[Catálogo] Usando data/catalog.json');
}

async function loadMetropolitano(){
  const [stopsMet, svcsMet] = await Promise.all([
    fetchJSON(`${PATHS.met}/metropolitano_stops.json`),
    fetchJSON(`${PATHS.met}/metropolitano_services.json`)
  ]);

  state.systems.met.stops = stopsArrayToMap(stopsMet.stations);

  const colorsMet = svcsMet.colors || {};
  const metAll = (svcsMet.services || []).map(s => ({
    ...s,
    system: 'met',
    color: colorsMet[String(s.id)] || '#0ea5e9'
  }));

  state.systems.met.services = filterByCatalogFor('met', metAll, state.catalog);

  await loadMetMacros();
}

async function loadAlimentadores(){
  try {
    const alim = await fetchJSON(`${PATHS.met}/alimentadores.json`);
    if (alim && alim.type === 'FeatureCollection') {
      const parsed = buildAlimFromFC(alim);
      state.systems.alim.stops    = parsed.stops;
      state.systems.alim.services = filterByCatalogFor('alim', parsed.services, state.catalog);
      console.log('[Alimentadores] Rutas creadas:', parsed.services.length);
    } else {
      console.warn('[Alimentadores] El archivo no es FeatureCollection o está vacío.');
      state.systems.alim.stops = new Map();
      state.systems.alim.services = [];
    }
  } catch (e) {
    console.warn('Alimentadores no disponibles:', e.message);
    state.systems.alim.stops = new Map();
    state.systems.alim.services = [];
  }
}

async function loadCorredores(){
  try {
    const corrRaw = await fetchJSON(`${PATHS.corr}/corredores.json`);
    let services = [];
    let infoLog  = '';

    if (corrRaw && corrRaw.type === 'FeatureCollection') {
      const parsed = buildCorredoresFromFC(corrRaw);
      state.systems.corr.stops = parsed.stops;
      services                 = parsed.services;
      infoLog = '[Corredores] Rutas creadas: ' + services.length +
                ' | Features sin ref: ' + parsed.noRef;
    } else if (corrRaw && Array.isArray(corrRaw.services)) {
      services = corrRaw.services;
      state.systems.corr.stops = corrRaw.stops ? stopsArrayToMap(corrRaw.stops) : new Map();
      infoLog = '[Corredores] Rutas (obj): ' + services.length;
    } else {
      console.warn('[Corredores] Formato no reconocido:', corrRaw ? corrRaw.type : typeof corrRaw);
      state.systems.corr.stops = new Map();
      services = [];
    }

    state.systems.corr.services = filterByCatalogFor('corr', services, state.catalog);
    if (infoLog) console.log(infoLog);
    console.log('[Corredores] Rutas finales:', state.systems.corr.services.length);
  } catch (e) {
    console.warn('Corredores no disponibles:', e.message);
    state.systems.corr.stops = new Map();
    state.systems.corr.services = [];
  }
}

async function loadMetro(){
  try {
    let parsed = null;
    let source = '';

    try {
      const metroGeo = await fetchJSON(`${PATHS.metro}/metro.geojson`);
      if (metroGeo && metroGeo.type === 'FeatureCollection') {
        parsed = buildMetroFromJSON(metroGeo);
        source = 'metro.geojson';
      }
    } catch (e1) {
      console.warn('[Metro] No se pudo leer metro.geojson:', e1.message);
    }

    if (!parsed) {
      const metroRaw = await fetchJSON(`${PATHS.metro}/metro.json`);
      parsed = buildMetroFromJSON(metroRaw);
      source = 'metro.json';
    }

    state.systems.metro.stops    = parsed.stops;
    state.systems.metro.services = filterByCatalogFor('metro', parsed.services, state.catalog);

    const metroIds = state.systems.metro.services.map(s => s.id);
    console.log('[Metro] Fuente:', source, '| Líneas detectadas:', metroIds.join(', ') || '-');
  } catch (e) {
    console.warn('Metro no disponible:', e.message);
    state.systems.metro.stops = new Map();
    state.systems.metro.services = [];
  }
}

/* ===========================
   Wikiroutes (lazy meta)
   =========================== */

function buildWrUiAndDefsFromWrMap(wrMap){
  const routeDefs = new Map(); // id real -> {folder,color,trip,name}
  const routesUi = [];

  const routesObj = wrMap?.routes && typeof wrMap.routes === 'object' ? wrMap.routes : null;
  if (!routesObj) return { routeDefs, routesUi };

  // Definiciones físicas por id real (ej. "1244-ida", "1244-vuelta")
  for (const [rid, conf] of Object.entries(routesObj)) {
    const folderRel = conf.folder || `route_${rid}`;
    const folder = folderRel.startsWith('data/')
      ? folderRel
      : `${PATHS.wr}/${folderRel}`;

    routeDefs.set(String(rid), {
      folder,
      color: conf.color || '#00008C',
      trip: conf.trip,
      name: conf.name || `Ruta ${rid}`
    });
  }

  // UI combinada agrupando ida/vuelta bajo el código moderno (base)
  const groups = new Map();
  for (const rid of Object.keys(routesObj)) {
    const m = rid.match(/^(.*?)-(ida|vuelta)$/i);
    if (m) {
      const base = m[1];
      const dir  = m[2].toLowerCase();
      if (!groups.has(base)) groups.set(base, { base, ida:null, vuelta:null });
      groups.get(base)[dir] = rid;
    } else {
      routesUi.push({
        id: rid,
        name: routesObj[rid].name || `Ruta ${rid}`,
        color: routesObj[rid].color || '#00008C'
      });
    }
  }

  groups.forEach(g => {
    if (g.ida && g.vuelta) {
      const baseColor = (routesObj[g.ida].color || routesObj[g.vuelta].color || '#00008C');
      routesUi.push({
        id: g.base,                 // aquí el id visible es el código moderno, p.ej. "1244"
        name: `Wikiroutes ${g.base}`,
        color: baseColor,
        pair: { ida: g.ida, vuelta: g.vuelta }
      });
    } else {
      const only = g.ida || g.vuelta;
      if (only) {
        routesUi.push({
          id: only,
          name: routesObj[only].name || `Ruta ${only}`,
          color: routesObj[only].color || '#00008C'
        });
      }
      }
  });

  return { routeDefs, routesUi };
}

async function loadWikiroutesMeta(){
  try {
    let wrMap = await fetchJSON(`config/wr_map.json`).catch(()=>null);
    if (!wrMap) wrMap = await fetchJSON(`${PATHS.data}/config/wr_map.json`).catch(()=>null);

    state.systems.wr.routes    = [];
    state.systems.wr.routesUi  = [];
    state.systems.wr.routeDefs = new Map();

    if (wrMap?.routes && typeof wrMap.routes === 'object') {
      const { routeDefs, routesUi } = buildWrUiAndDefsFromWrMap(wrMap);

      // Catalogo principal: se usa catalog.transporte y código moderno
      const cat   = state.catalog || {};
      const trans = cat.transporte || {};
      const upper = s => String(s).toUpperCase();

      const onlySet = Array.isArray(trans.only)
        ? new Set(trans.only.map(upper))
        : null;
      const excSet  = Array.isArray(trans.exclude)
        ? new Set(trans.exclude.map(upper))
        : new Set();

      // Filtrado de UI por código moderno (base antes de "-ida"/"-vuelta")
      const filteredUi = routesUi.filter(rt => {
        const base = upper(String(rt.id).split('-')[0]); // "1244-ida" -> "1244", "1244" -> "1244"
        if (excSet.has(base)) return false;
        if (onlySet && !onlySet.has(base)) return false;
        return true;
      });

      // Filtrado de definiciones físicas por el mismo código moderno
      const filteredDefs = new Map();
      routeDefs.forEach((def, rid) => {
        const base = upper(String(rid).split('-')[0]);
        if (excSet.has(base)) return;
        if (onlySet && !onlySet.has(base)) return;
        filteredDefs.set(rid, def);
      });

      state.systems.wr.routeDefs = filteredDefs;
      state.systems.wr.routesUi  = filteredUi;
      state.systems.wr.routes    = filteredUi;

      console.log(
        '[WR] UI (lazy, filtrada por catalog.transporte):',
        state.systems.wr.routesUi.map(r => r.id).join(', ') || '(ninguna)'
      );
      return;
    }

    // Fallback a un solo folder fijo si no hay wr_map.routes
    const wrFolder  = `${PATHS.wr}/route_154193`;
    const meta      = await fetchJSON(`${wrFolder}/route.json`).catch(()=>null);
    const overrides = await fetchJSON(`config/wr_overrides.json`).catch(()=> ({}));
    const ov = overrides?.['route_154193'] || overrides?.['154193'] || null;

    const displayId = String(ov?.display_id || meta?.ref || '154193');
    const color     = ov?.color || '#00008C';
    const name      = ov?.name  || meta?.name || `Ruta ${displayId} (Wikiroutes)`;

    state.systems.wr.routeDefs = new Map([
      [displayId, { folder: wrFolder, color, trip: 1, name }]
    ]);
    state.systems.wr.routesUi = [{ id: displayId, name, color }];
    state.systems.wr.routes   = state.systems.wr.routesUi;

    console.log('[WR] Fallback UI (lazy):', displayId);
  } catch (e) {
    console.warn('[WR] No se pudo preparar el catálogo:', e.message);
    state.systems.wr.routes    = [];
    state.systems.wr.routesUi  = [];
    state.systems.wr.routeDefs = new Map();
  }
}

/* ===========================
   Init principal
   =========================== */

async function init(){
  initMap();

  // Sidebar: estado de carga desde el inicio
  disableSidebarChecks(true);
  setSidebarLoading(true, 'Cargando rutas y paraderos...');
  setStatus('Cargando...');

  // Placeholders visibles en listas
  setListPlaceholder($('#p-met-reg'), 'Cargando Metropolitano (regulares)...');
  setListPlaceholder($('#p-met-exp'), 'Cargando Metropolitano (expresos)...');
  setListPlaceholder($('#p-met-alim-n'), 'Cargando Alimentadores (Norte)...');
  setListPlaceholder($('#p-met-alim-s'), 'Cargando Alimentadores (Sur)...');
  setListPlaceholder($('#p-corr-list'), 'Cargando Corredores...');
  setListPlaceholder($('#p-metro'), 'Cargando Metro...');
  setListPlaceholder($('#p-wr'), 'Cargando Wikiroutes...');

  // Pintar UI antes de descargar todo
  await nextFrame();

  // Catálogo primero
  await loadCatalog();

  // Cargar sistemas en paralelo (WR solo meta)
  setStatus('Cargando datos...');
  await Promise.all([
    (async () => { setStatus('Cargando Metropolitano...'); await loadMetropolitano(); })(),
    (async () => { setStatus('Cargando Alimentadores...'); await loadAlimentadores(); })(),
    (async () => { setStatus('Cargando Corredores...'); await loadCorredores(); })(),
    (async () => { setStatus('Cargando Metro...'); await loadMetro(); })(),
    (async () => { setStatus('Cargando Wikiroutes...'); await loadWikiroutesMeta(); })()
  ]);

  // Construir UI
  buildUI();

  // WR: NO auto activar nada al iniciar
  const wr = state.systems.wr;
  if (wr && wr.layers) {
    wr.layers.forEach((layer, id) => {
      if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
      const stopSub = wr.stopLayers?.get(id);
      if (stopSub && state.map.hasLayer(stopSub)) state.map.removeLayer(stopSub);
    });
  }

  // Asegurar checks WR OFF
  const topWr = document.getElementById('chk-wr');
  if (topWr) { topWr.checked = false; topWr.indeterminate = false; }
  $$('#p-wr .item input[type="checkbox"]').forEach(chk => { chk.checked = false; });

  // Si hay pares ida/vuelta, dejar “ida” por defecto (sin dibujar)
  (state.systems.wr.routesUi || state.systems.wr.routes || []).forEach(rt => {
    const leaf = document.querySelector(`#p-wr .item input[data-id="${rt.id}"]`);
    if (leaf && rt.pair) leaf.dataset.sel = 'ida';
  });

  // Final
  syncAllTri();
  disableSidebarChecks(false);
  setSidebarLoading(false);
  setStatus('Listo');
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
  state.systems.metro.ui.list   = $('#p-metro');
  state.systems.metro.ui.chkAll = $('#chk-metro');

  // refs Wikiroutes
  state.systems.wr.ui.list   = $('#p-wr');
  state.systems.wr.ui.chkAll = $('#chk-wr');

  // Llenar listas
  fillMetList();
  fillAlimList();
  fillCorrList();
  fillMetroList();
  fillWrList();

  // Jerarquía
  wireHierarchy();

  // Base clara/oscura
  const btnLight = $('#btnLight');
  const btnDark  = $('#btnDark');
  btnLight && btnLight.addEventListener('click', () => setBase('light'));
  btnDark  && btnDark .addEventListener('click', () => setBase('dark'));

  // Dirección (expresos Metropolitano)
  $$('input[name="dir"]').forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) {
        state.dir = r.value;
        reRenderVisibleSystem('met');
      }
    });
  });

  // Mostrar paraderos
  const chkStops = $('#chkStops');
  if (chkStops){
    chkStops.checked = true;
    chkStops.addEventListener('change', () => {
      state.showStops = chkStops.checked;
      reRenderVisible();
    });
  }

  // Auto-fit
  const chkFit = $('#chkAutoFit');
  if (chkFit){
    chkFit.checked = true;
    chkFit.addEventListener('change', () => {
      state.autoFit = chkFit.checked;
    });
  }

  // Desmarcar todo
  const btnClearAll = $('#btnClearAll');
  if (btnClearAll){
    btnClearAll.addEventListener('click', () => {
      bulk(() => {
        // Met
        setLevel2Checked('met',  state.systems.met.ui.chkReg, false, { silentFit: true });
        setLevel2Checked('met',  state.systems.met.ui.chkExp, false, { silentFit: true });
        state.systems.met.ui.chkAll.checked = false;
        // Alim
        setLevel2Checked('alim', state.systems.alim.ui.chkN,  false, { silentFit: true });
        setLevel2Checked('alim', state.systems.alim.ui.chkS,  false, { silentFit: true });
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
        // Wikiroutes
        if (state.systems.wr.ui.chkAll){
          state.systems.wr.ui.chkAll.checked = false;
          onLevel1ChangeWr();
        }
      });
      syncAllTri();
    });
  }

  // Pestañas desplegables
  // Pestañas desplegables
  wirePanelTogglesOnce();

  // Buscador de rutas, empresas y códigos
  // Se inicializa al final para que todos los sistemas estén cargados.
  setupSearch();
}


// Lanzar
init().catch(err => {
  console.error(err);
  setSidebarLoading(false);
  disableSidebarChecks(false);
  setStatus('Error al iniciar');
});
