/* assets/js/app.js
 * Mapa de Rutas — Metropolitano (estable y sin bucles de eventos)
 * Estructura asumida:
 *  - assets/js/app.js
 *  - assets/css/styles.css
 *  - data/catalog.json
 *  - data/metropolitano/metropolitano_services.json
 *  - data/metropolitano/metropolitano_stops.json
 *  - images/metropolitano/{A,B,C,D,1..13,L,SX,SXN}.png
 */

console.groupCollapsed('INIT');

const PATHS = {
  data: 'data',
  metro: 'data/metropolitano',
  icons: 'images/metropolitano'
};

const state = {
  map: null,
  baseLayers: { light: null, dark: null },
  currentBase: 'light',
  dir: 'ambas',          // ambas | ns | sn
  showStops: true,
  autoFit: true,

  catalog: null,
  stops: new Map(),      // id -> {lat,lon,name}
  services: [],          // servicios (ya filtrados + color resuelto)

  // capas por servicio
  lineLayers: new Map(), // id -> L.LayerGroup
  stopLayers: new Map(), // id -> L.LayerGroup

  // UI refs
  ui: {
    listReg: null,
    listExp: null,
    chkMet: null,
    chkMetReg: null,
    chkMetExp: null,
    chkStops: null,
    chkAutoFit: null,
    radiosDir: [],
    btnLight: null,
    btnDark: null,
    search: null,
    clearSearch: null
  },

  // flag para evitar bucles en tri-state
  suspendTri: false
};

// -------------------- helpers --------------------
const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

async function fetchJSON(path) {
  console.log('fetch', path);
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${path}`);
  const j = await r.json();
  console.log('OK', j);
  return j;
}

function stopsArrayToMap(stations) {
  const m = new Map();
  for (const s of stations) m.set(s.id, s);
  return m;
}

function iconUrlFor(id) {
  return `${PATHS.icons}/${String(id).toUpperCase()}.png`;
}

function uniqueOrder(latlngs) {
  const out = [];
  let prev = null;
  for (const ll of latlngs) {
    if (!ll) continue;
    if (!prev || ll[0] !== prev[0] || ll[1] !== prev[1]) out.push(ll);
    prev = ll;
  }
  return out;
}

// -------------------- mapa --------------------
function initMap() {
  console.log('MAP:init');

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
  state.baseLayers.dark = dark;
}

function setBase(theme) {
  if (theme === state.currentBase) return;
  state.map.removeLayer(state.baseLayers[state.currentBase]);
  state.map.addLayer(state.baseLayers[theme]);
  state.currentBase = theme;
}

// -------------------- catálogo --------------------
function filterByCatalog(services, catalog) {
  const cfg = catalog?.metropolitano?.rutas || {};
  const only = Array.isArray(cfg.only)
    ? new Set(cfg.only.map((x) => String(x).toUpperCase()))
    : null;
  const exclude = Array.isArray(cfg.exclude)
    ? new Set(cfg.exclude.map((x) => String(x).toUpperCase()))
    : new Set();

  let out = services.filter((s) => !exclude.has(String(s.id).toUpperCase()));
  if (only) out = out.filter((s) => only.has(String(s.id).toUpperCase()));
  return out;
}

// -------------------- UI builders --------------------
function makeServiceItem(svc) {
  const img = el('img', { src: iconUrlFor(svc.id), class: 'badge', alt: svc.id });
  img.onerror = () => {
    img.replaceWith(
      el(
        'span',
        { class: 'badge', style: `background:${svc.color}` },
        String(svc.id)
      )
    );
  };

  const left = el(
    'div',
    { class: 'left' },
    img,
    el(
      'div',
      {},
      el(
        'div',
        { class: 'name' },
        `${svc.kind === 'regular' ? 'Ruta' : 'Expreso'} ${svc.id}`
      ),
      el('div', { class: 'sub' }, svc.name || '')
    )
  );

  const chk = el('input', {
    type: 'checkbox',
    'data-id': svc.id,
    'aria-label': `Mostrar ${svc.name || svc.id}`
  });

  // Por defecto apagado para no saturar (el usuario va activando)
  chk.checked = false;

  // Cambio: render/hide directo (sin re-despachar change para evitar cascadas)
  chk.addEventListener('change', () => {
    onToggleService(svc.id, chk.checked, { silentFit: false });
    updateTriStateAll();
  });

  return el('div', { class: 'item' }, left, chk);
}

function ensureOptionsPanel() {
  // Si tu HTML no tiene los controles, los creamos.
  if (!$('#options-panel')) {
    const panel = el(
      'section',
      { class: 'panel', id: 'options-panel' },
      el(
        'div',
        { class: 'panel-body' },
        // Dirección
        el('div', { class: 'group' },
          el('label', { class: 'label' }, 'Dirección'),
          el('div', { class: 'radios' },
            el('label', {}, el('input', { type: 'radio', name: 'dir', value: 'ambas', checked: 'checked' }), ' Ambas'),
            el('label', {}, el('input', { type: 'radio', name: 'dir', value: 'ns' }), ' N→S'),
            el('label', {}, el('input', { type: 'radio', name: 'dir', value: 'sn' }), ' S→N')
          )
        ),
        // Mostrar paradas
        el('div', { class: 'group' },
          el('label', { class: 'label' },
            el('input', { type: 'checkbox', id: 'chkStops', checked: 'checked' }),
            ' Mostrar paradas'
          )
        ),
        // Auto-centrar
        el('div', { class: 'group' },
          el('label', { class: 'label' },
            el('input', { type: 'checkbox', id: 'chkAutoFit', checked: 'checked' }),
            ' Auto-centrar al seleccionar'
          )
        ),
        // Tema
        el('div', { class: 'group' },
          el('label', { class: 'label' }, 'Tema'),
          el('div', { class: 'row' },
            el('button', { class: 'btn small', id: 'btnLight' }, 'Mapa claro'),
            el('button', { class: 'btn small', id: 'btnDark' }, 'Mapa oscuro')
          )
        ),
        el('div', { id: 'status', class: 'status' }, 'Listo')
      )
    );
    // Lo insertamos al final del contenedor de paneles si existe, si no al sidebar
    const panels = $('#panels') || $('#sidebar') || document.body;
    panels.append(panel);
  }
}

function buildUI() {
  console.log('UI:build Metropolitano');

  state.ui.listReg = $('#p-met-reg');
  state.ui.listExp = $('#p-met-exp');
  state.ui.chkMet = $('#chk-met');
  state.ui.chkMetReg = $('#chk-met-reg');
  state.ui.chkMetExp = $('#chk-met-exp');

  if (!state.ui.listReg || !state.ui.listExp) {
    console.warn('No se encontraron contenedores de listas de servicios.');
    return;
  }

  // Limpiar
  state.ui.listReg.innerHTML = '';
  state.ui.listExp.innerHTML = '';

  const regs = state.services.filter((s) => s.kind === 'regular');
  const exps = state.services.filter((s) => s.kind === 'expreso');

  for (const s of regs) state.ui.listReg.appendChild(makeServiceItem(s));
  for (const s of exps) state.ui.listExp.appendChild(makeServiceItem(s));

  // Wire de tri-state (sin recursión)
  wireTriState();
}

function wireTriState() {
  const met = (state.ui.chkMet = $('#chk-met'));
  const reg = (state.ui.chkMetReg = $('#chk-met-reg'));
  const exp = (state.ui.chkMetExp = $('#chk-met-exp'));

  const regChildren = $all('#p-met-reg .item input[type="checkbox"]');
  const expChildren = $all('#p-met-exp .item input[type="checkbox"]');

  const applyToChildren = (nodes, checked) => {
    // Cambiamos hijos y dibujamos/ocultamos directamente
    for (const n of nodes) {
      if (n.checked === checked) continue;
      n.checked = checked;
      onToggleService(n.dataset.id, checked, { silentFit: true });
    }
  };

  // Cambios del padre "Metropolitano"
  met?.addEventListener('change', () => {
    if (state.suspendTri) return;
    state.suspendTri = true;
    applyToChildren(regChildren, met.checked);
    applyToChildren(expChildren, met.checked);
    // Sin cascada; actualizamos estados visuales
    updateTriStateAll();
    // Ajuste de mapa una sola vez
    reFitAllVisible();
    state.suspendTri = false;
  });

  // Cambios de padres parciales
  reg?.addEventListener('change', () => {
    if (state.suspendTri) return;
    state.suspendTri = true;
    applyToChildren(regChildren, reg.checked);
    updateTriStateAll();
    reFitAllVisible();
    state.suspendTri = false;
  });

  exp?.addEventListener('change', () => {
    if (state.suspendTri) return;
    state.suspendTri = true;
    applyToChildren(expChildren, exp.checked);
    updateTriStateAll();
    reFitAllVisible();
    state.suspendTri = false;
  });

  // Cambios en cada hijo actualizan tri-state pero sin propagar eventos
  [...regChildren, ...expChildren].forEach((n) => {
    n.addEventListener('change', () => {
      if (state.suspendTri) return;
      updateTriStateAll();
    });
  });

  // Primer cálculo
  updateTriStateAll();
}

function updateTriStateAll() {
  const met = $('#chk-met');
  const reg = $('#chk-met-reg');
  const exp = $('#chk-met-exp');

  const regChildren = $all('#p-met-reg .item input[type="checkbox"]');
  const expChildren = $all('#p-met-exp .item input[type="checkbox"]');

  const setFromChildren = (parent, nodes) => {
    const total = nodes.length;
    const checked = nodes.filter((n) => n.checked).length;
    parent.indeterminate = checked > 0 && checked < total;
    parent.checked = total > 0 && checked === total;
  };

  if (reg) setFromChildren(reg, regChildren);
  if (exp) setFromChildren(exp, expChildren);

  if (met) {
    const parts = [reg, exp].filter(Boolean);
    const all = parts.length && parts.every((p) => p.checked);
    const some =
      parts.length &&
      (parts.some((p) => p.indeterminate) ||
        (parts.some((p) => p.checked) && !all));
    met.indeterminate = some;
    met.checked = all;
  }
}

// -------------------- render --------------------
function getStopLatLng(id) {
  const s = state.stops.get(id);
  if (!s) {
    console.warn('Stop not found:', id);
    return null;
  }
  return [s.lat, s.lon];
}

function ensureGroups(id) {
  if (!state.lineLayers.has(id))
    state.lineLayers.set(id, L.layerGroup().addTo(state.map));
  if (!state.stopLayers.has(id))
    state.stopLayers.set(id, L.layerGroup().addTo(state.map));
}

function clearServiceLayers(id) {
  state.lineLayers.get(id)?.clearLayers();
  state.stopLayers.get(id)?.clearLayers();
}

function renderService(id) {
  const svc = state.services.find(
    (s) => String(s.id).toUpperCase() === String(id).toUpperCase()
  );
  if (!svc) return;

  ensureGroups(svc.id);
  clearServiceLayers(svc.id);

  const gLine = state.lineLayers.get(svc.id);
  const gStop = state.stopLayers.get(svc.id);

  let bounds = null;

  const addPath = (stopIds) => {
    const pts = uniqueOrder(stopIds.map(getStopLatLng).filter(Boolean));
    if (pts.length < 2) return;

    const poly = L.polyline(pts, {
      color: svc.color || '#0ea5e9',
      weight: 4,
      opacity: 0.95
    }).addTo(gLine);

    bounds = bounds ? bounds.extend(poly.getBounds()) : poly.getBounds();

    if (state.showStops) {
      const used = new Set();
      for (const sid of stopIds) {
        if (used.has(sid)) continue;
        used.add(sid);
        const ll = getStopLatLng(sid);
        if (!ll) continue;
        L.circleMarker(ll, { radius: 3, weight: 1, opacity: 0.9 })
          .addTo(gStop)
          .bindTooltip(state.stops.get(sid)?.name || sid, {
            permanent: false,
            direction: 'top',
            offset: [0, -6]
          });
      }
    }
  };

  if (svc.kind === 'regular') {
    addPath(svc.stops || []);
  } else {
    if (state.dir === 'ambas' || state.dir === 'ns') addPath(svc.north_south || []);
    if (state.dir === 'ambas' || state.dir === 'sn') addPath(svc.south_north || []);
  }

  return bounds;
}

function hideService(id) {
  state.lineLayers.get(id)?.clearLayers();
  state.stopLayers.get(id)?.clearLayers();
}

function onToggleService(id, checked, opts = { silentFit: false }) {
  let b = null;
  if (checked) b = renderService(id);
  else hideService(id);

  if (!opts.silentFit && state.autoFit && b) {
    state.map.fitBounds(b.pad(0.08));
  }
}

function reRenderVisible() {
  // Re-dibuja sólo los que están marcados
  const boxes = $all('#p-met-reg .item input[type="checkbox"], #p-met-exp .item input[type="checkbox"]');
  let union = null;
  for (const chk of boxes) {
    if (chk.checked) {
      const b = renderService(chk.dataset.id);
      if (b) union = union ? union.extend(b) : b;
    } else {
      hideService(chk.dataset.id);
    }
  }
  if (state.autoFit && union) state.map.fitBounds(union.pad(0.08));
}

function reFitAllVisible() {
  // Une bounds de todo lo visible (para cuando tildas muchos a la vez)
  const boxes = $all('#p-met-reg .item input[type="checkbox"], #p-met-exp .item input[type="checkbox"]');
  let union = null;
  for (const chk of boxes) {
    if (!chk.checked) continue;
    const group = state.lineLayers.get(chk.dataset.id);
    if (!group) continue;
    group.eachLayer((layer) => {
      const b = layer.getBounds?.();
      if (b) union = union ? union.extend(b) : b;
    });
  }
  if (state.autoFit && union) state.map.fitBounds(union.pad(0.08));
}

// -------------------- wiring (controles) --------------------
function wireControls() {
  // Paneles (abrir/cerrar). Si tu HTML ya lo hace con CSS, esto no molesta.
  $all('.panel .panel-head').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return; // no colisionar con checkbox derecha
      const id = btn.getAttribute('data-target');
      if (!id) return;
      btn.parentElement.classList.toggle('open');
    });
  });

  // Dirección
  state.ui.radiosDir = $all('input[name="dir"]');
  state.ui.radiosDir.forEach((r) =>
    r.addEventListener('change', () => {
      if (r.checked) {
        state.dir = r.value;
        reRenderVisible();
      }
    })
  );

  // Mostrar paradas
  state.ui.chkStops = $('#chkStops');
  if (state.ui.chkStops) {
    state.ui.chkStops.checked = true;
    state.ui.chkStops.addEventListener('change', () => {
      state.showStops = state.ui.chkStops.checked;
      reRenderVisible();
    });
  }

  // Auto-centrar
  state.ui.chkAutoFit = $('#chkAutoFit');
  if (state.ui.chkAutoFit) {
    state.ui.chkAutoFit.checked = true;
    state.ui.chkAutoFit.addEventListener('change', () => {
      state.autoFit = state.ui.chkAutoFit.checked;
    });
  }

  // Tema
  state.ui.btnLight = $('#btnLight');
  state.ui.btnDark = $('#btnDark');
  state.ui.btnLight?.addEventListener('click', () => setBase('light'));
  state.ui.btnDark?.addEventListener('click', () => setBase('dark'));

  // Desmarcar todo
  $('#btnClearAll')?.addEventListener('click', () => {
    const boxes = $all('#p-met-reg .item input[type="checkbox"], #p-met-exp .item input[type="checkbox"]');
    for (const b of boxes) {
      if (!b.checked) continue;
      b.checked = false;
      hideService(b.dataset.id);
    }
    updateTriStateAll();
  });

  // Búsqueda
  state.ui.search = $('#searchInput');
  state.ui.clearSearch = $('#btnClearSearch');

  const doSearch = () => {
    const q = (state.ui.search?.value || '').trim().toLowerCase();
    if (!q) return;

    const hit = state.services.find(
      (s) =>
        String(s.id).toLowerCase() === q ||
        (s.name || '').toLowerCase().includes(q)
    );
    if (!hit) return;

    const node = document.querySelector(
      `.item input[data-id="${hit.id}"]`
    );
    if (node) {
      node.checked = true;
      onToggleService(hit.id, true, { silentFit: false });
      updateTriStateAll();
      node.closest('.item')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  state.ui.search?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  state.ui.clearSearch?.addEventListener('click', () => {
    if (state.ui.search) state.ui.search.value = '';
  });
}

// -------------------- INIT --------------------
async function init() {
  console.log('INIT');
  initMap();
  ensureOptionsPanel(); // crea los controles si faltan

  // Cargar datos
  const catalog = await fetchJSON(`${PATHS.data}/catalog.json`).catch(() => null);
  const stopsJ = await fetchJSON(`${PATHS.metro}/metropolitano_stops.json`);
  const svcsJ = await fetchJSON(`${PATHS.metro}/metropolitano_services.json`);

  state.catalog = catalog;
  state.stops = stopsArrayToMap(stopsJ.stations || []);

  const colors = svcsJ.colors || {};
  const allServices = (svcsJ.services || []).map((s) => ({
    ...s,
    color: colors[String(s.id)] || '#0ea5e9'
  }));
  state.services = filterByCatalog(allServices, catalog);

  console.groupCollapsed('Datos cargados');
  console.log('stops:', state.stops.size);
  console.log('services:', state.services.map((s) => s.id));
  console.groupEnd();

  buildUI();
  wireControls();

  const st = $('#status');
  if (st) st.textContent = 'Listo';
}

init().catch((err) => {
  console.error(err);
  const st = $('#status');
  if (st) st.textContent = 'Error al iniciar';
});

console.groupEnd();
