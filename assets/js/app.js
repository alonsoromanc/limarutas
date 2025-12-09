// app.js (punto de entrada)
import { PATHS, state } from './config.js';
import { $, $$, fetchJSON, stopsArrayToMap, asLatLng } from './utils.js';
import {
  filterByCatalogFor,
  buildAlimFromFC,
  buildCorredoresFromFC,
  buildMetroFromJSON,
  buildWikiroutesLayer
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
    console.log('[Met macro]', `${macroId}-${suffix}:`, segments.length, 'segmentos');
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
   Init principal
   =========================== */

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
  const metAll = (svcsMet.services || []).map(s => ({
    ...s,
    system: 'met',
    color: colorsMet[String(s.id)] || '#0ea5e9'
  }));
  state.systems.met.services = filterByCatalogFor('met', metAll, state.catalog);

  // Macrorutas Metropolitano
  await loadMetMacros();

  // Alimentadores
  try {
    const alim = await fetchJSON(`${PATHS.met}/alimentadores.json`);
    if (alim && alim.type === 'FeatureCollection') {
      const parsed = buildAlimFromFC(alim);
      state.systems.alim.stops    = parsed.stops;
      state.systems.alim.services = filterByCatalogFor('alim', parsed.services, state.catalog);
      console.log('[Alimentadores] Rutas creadas:', parsed.services.length);
    } else {
      console.warn('[Alimentadores] El archivo no es FeatureCollection o está vacío.');
    }
  } catch (e) {
    console.warn('Alimentadores no disponibles:', e.message);
  }

  // Corredores
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

  // Metro
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
  }

  /* ===========================
     Wikiroutes (desde data/processed/transporte/route_154193)
     =========================== */
  try {
    const wrFolder = `${PATHS.wr}/route_154193`;

    // Lee meta si existe para nombrar bien el item
    const meta = await fetchJSON(`${wrFolder}/route.json`).catch(()=>null);
    const rid  = String(meta?.route_id || '154193');
    const rname =
      meta?.name ||
      (meta?.ref ? `Ruta ${meta.ref}` : `Ruta ${rid}`) +
      (meta?.city ? ` (${meta.city})` : '');

    state.systems.wr.routes = [{
      id: rid,
      name: rname || `Ruta ${rid} (Wikiroutes)`,
      color: '#00008C',
      folder: wrFolder
    }];

    await buildWikiroutesLayer(rid, wrFolder, { color: '#00008C' });
    console.log('[WR] Cargada', rid, 'desde', wrFolder);
  } catch (e) {
    console.warn('[WR] No se pudo construir la capa:', e.message);
    state.systems.wr.routes = [];
  }

  // Construir UI
  buildUI();

  // Auto-activar la WR si existe
  const wrLeaf = document.querySelector('#p-wr .item input[type="checkbox"]');
  if (wrLeaf && !wrLeaf.checked) {
    wrLeaf.checked = true;
    wrLeaf.dispatchEvent(new Event('change', { bubbles: true }));
  }
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
  wirePanelTogglesOnce();

  const statusEl = $('#status');
  if (statusEl) statusEl.textContent = 'Listo';
}

// Lanzar
init().catch(err => {
  console.error(err);
  const status = document.getElementById('status');
  if (status) status.textContent = 'Error al iniciar';
});
