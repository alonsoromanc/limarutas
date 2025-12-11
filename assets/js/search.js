// search.js
import { PATHS, state } from './config.js';
import { $, el } from './utils.js';

function norm(text){
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractSiglas(empresa){
  if (!empresa) return '';
  const m = String(empresa).match(/\(([^()]+)\)\s*\)?$/);
  return m ? m[1].trim() : '';
}

let listaPromise = null;

async function loadListaRutas(){
  if (listaPromise) return listaPromise;

  async function tryFetch(url){
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const txt = await resp.text();
      return parseListaCsv(txt);
    } catch (e) {
      console.warn('[search] No se pudo leer', url, e.message);
      return null;
    }
  }

  listaPromise = (async () => {
    // Primero en config/, luego en data/config/
    const direct = await tryFetch('config/lista_rutas.csv');
    if (direct && direct.length) return direct;

    const alt = await tryFetch(`${PATHS.data}/config/lista_rutas.csv`);
    if (alt && alt.length) return alt;

    return [];
  })();

  return listaPromise;
}

function parseListaCsv(text){
  const lines = text.split(/[\r\n]+/).filter(l => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return [];
  const header = lines[0].split(',').map(h => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++){
    const row = lines[i];
    if (!row.trim()) continue;
    const cols = row.split(',');
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = (cols[idx] || '').trim();
    });
    out.push(obj);
  }
  return out;
}

function typeLabel(doc){
  switch (doc.type){
    case 'met':   return 'Metropolitano';
    case 'alim':  return 'Alimentadores';
    case 'corr':  return 'Corredores';
    case 'metro': return 'Metro de Lima';
    case 'wr':    return 'Transporte público tradicional';
    default:      return '';
  }
}

async function buildSearchIndex(){
  if (Array.isArray(state._searchIndex) && state._searchIndex.length){
    return state._searchIndex;
  }

  const docs = [];

  // Metropolitano (troncales A, B, C, etc.)
  const metSvcs = (state.systems.met && state.systems.met.services) || [];
  for (const svc of metSvcs){
    if (!svc) continue;
    const id = String(svc.id);
    const name = svc.name || '';
    const kind = svc.kind || '';
    const kindLabel =
      kind === 'expreso'  ? 'Expreso' :
      kind === 'regular'  ? 'Ruta regular' :
      kind ? kind : '';

    const mainLabel = name || `Servicio ${id}`;
    const label = kindLabel ? `${id} · ${mainLabel} (${kindLabel})` : `${id} · ${mainLabel}`;
    const tokens = norm([id, name, kindLabel, 'metropolitano', 'troncal'].join(' '));

    docs.push({
      key: `met:${id}`,
      system: 'met',
      id,
      label,
      type: 'met',
      tokens
    });
  }

  // Alimentadores del Metropolitano
  const alimSvcs = (state.systems.alim && state.systems.alim.services) || [];
  for (const svc of alimSvcs){
    if (!svc) continue;
    const id = String(svc.id);
    const name = svc.name || '';
    const zone = svc.zone || '';
    const mainLabel = name || `Alimentador ${id}`;
    const label = zone ? `${id} · ${mainLabel} (${zone})` : `${id} · ${mainLabel}`;
    const tokens = norm([id, name, zone, 'alimentador', 'metropolitano'].join(' '));

    docs.push({
      key: `alim:${id}`,
      system: 'alim',
      id,
      label,
      type: 'alim',
      tokens
    });
  }

  // Corredores
  const corrSvcs = (state.systems.corr && state.systems.corr.services) || [];
  for (const svc of corrSvcs){
    if (!svc) continue;
    const id = String(svc.id);
    const name = svc.name || '';
    const op = svc.op || svc.operator || svc.company || '';
    const label = op ? `${id} · ${name} (${op})` : `${id} · ${name || 'Corredor'}`;
    const tokens = norm([id, name, op, 'corredor'].join(' '));

    docs.push({
      key: `corr:${id}`,
      system: 'corr',
      id,
      label,
      type: 'corr',
      tokens
    });
  }

  // Metro
  const metroSvcs = (state.systems.metro && state.systems.metro.services) || [];
  for (const svc of metroSvcs){
    if (!svc) continue;
    const id = String(svc.id);
    const name = svc.name || '';
    const label = name ? `${id} · ${name}` : `${id} · Metro de Lima`;
    const tokens = norm([id, name, 'metro', 'tren electrico'].join(' '));

    docs.push({
      key: `metro:${id}`,
      system: 'metro',
      id,
      label,
      type: 'metro',
      tokens
    });
  }

  // Transporte público tradicional (Wikiroutes + lista_rutas.csv)
  const wrUi = (state.systems.wr && (state.systems.wr.routes || state.systems.wr.routesUi)) || [];
  const lista = await loadListaRutas();
  const byNuevo = new Map();
  for (const row of lista){
    const nuevo = (row.codigo_nuevo || '').trim();
    if (!nuevo) continue;
    byNuevo.set(nuevo, row);
  }

  for (const rt of wrUi){
    if (!rt) continue;
    const idStr = String(rt.id);
    const base = idStr.split('-')[0];
    const row = byNuevo.get(base);

    const codigoNuevo   = (row && row.codigo_nuevo)   || base;
    const codigoAntiguo = (row && row.codigo_antiguo) || '';
    const alias         = (row && row.alias)          || '';
    const empresa       = (row && row.empresa_operadora) || '';
    const siglas        = extractSiglas(empresa);
    const empresaCorta  = siglas || empresa;

    let label;
    if (alias && empresaCorta){
      label = `${alias} – ${empresaCorta} (${codigoNuevo})`;
    } else if (alias){
      label = `${alias} (${codigoNuevo})`;
    } else if (empresaCorta){
      label = `${codigoNuevo} – ${empresaCorta}`;
    } else {
      label = rt.name || `Ruta ${codigoNuevo}`;
    }

    const tokens = norm([
      codigoNuevo,
      codigoAntiguo,
      alias,
      empresa,
      empresaCorta,
      rt.name || '',
      'transporte',
      'wikiroutes'
    ].join(' '));

    docs.push({
      key: `wr:${codigoNuevo}`,
      system: 'wr',
      id: rt.id, // coincide con data-id del checkbox
      label,
      type: 'wr',
      tokens,
      meta: { codigoNuevo, codigoAntiguo, alias, empresa, siglas: empresaCorta }
    });
  }

  state._searchIndex = docs;
  return docs;
}

function rankDocs(docs, query){
  const q = norm(query);
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const scored = [];
  for (const doc of docs){
    const hay = doc.tokens;
    let ok = true;
    let score = 0;
    for (const w of words){
      const idx = hay.indexOf(w);
      if (idx === -1){
        ok = false;
        break;
      }
      score += idx;
    }
    if (!ok) continue;

    let bias = 0;
    if (doc.type === 'wr') bias += 3;
    if (doc.type === 'metro') bias += 1;

    scored.push({ doc, score: score + bias });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.doc.label.localeCompare(b.doc.label, 'es');
  });

  return scored.map(s => s.doc);
}

function clearResults(resultsBox){
  resultsBox.innerHTML = '';
  resultsBox.style.display = 'none';
}

function renderResults(resultsBox, docs, selectedIndex){
  resultsBox.innerHTML = '';
  if (!docs.length){
    resultsBox.style.display = 'none';
    return;
  }
  const frag = document.createDocumentFragment();

  docs.forEach((doc, idx) => {
    const item = el('div', {
      class: 'search-item' + (idx === selectedIndex ? ' selected' : ''),
      'data-system': doc.system,
      'data-id': String(doc.id)
    });

    const title = el('div', { class: 'search-title' });
    title.textContent = doc.label;

    const meta = el('div', { class: 'search-meta' });
    meta.textContent = typeLabel(doc);

    item.appendChild(title);
    item.appendChild(meta);

    frag.appendChild(item);
  });

  resultsBox.appendChild(frag);
  resultsBox.style.display = 'block';
}

function selectDoc(doc){
  if (!doc) return;

  const system = doc.system;
  const id = String(doc.id);

  // Buscar el checkbox correspondiente en el sidebar
  let selector = `#sidebar input[type="checkbox"][data-system="${system}"][data-id="${CSS.escape(id)}"]`;
  let chk = document.querySelector(selector);

  // Para Wikiroutes, si no se encuentra por id completo, probar por base (codigo_nuevo)
  if (!chk && system === 'wr'){
    const base = id.split('-')[0];
    selector = `#sidebar input[type="checkbox"][data-system="wr"][data-id="${CSS.escape(base)}"]`;
    chk = document.querySelector(selector);
  }

  if (chk){
    if (!chk.checked){
      // Click real para respetar toda la lógica de wireHierarchy/mapLayers
      chk.click();
    }
    const item = chk.closest('.item');
    if (item && typeof item.scrollIntoView === 'function'){
      item.scrollIntoView({ block: 'nearest' });
    }
  }
}

export function setupSearch(){
  const input = $('#searchBox');
  const resultsBox = $('#searchResults');

  if (!input || !resultsBox){
    console.warn('[search] No se encontró #searchBox o #searchResults en el DOM.');
    return;
  }

  // Construir el índice en segundo plano para que esté listo al primer uso
  buildSearchIndex().catch(err => {
    console.warn('[search] Error al construir índice inicial:', err);
  });

  let currentDocs = [];
  let selectedIndex = -1;

  function resetSelection(){
    selectedIndex = -1;
  }

  input.addEventListener('input', async () => {
    const q = input.value;
    if (!q.trim()){
      currentDocs = [];
      resetSelection();
      clearResults(resultsBox);
      return;
    }

    const index = await buildSearchIndex();
    const hits = rankDocs(index, q).slice(0, 25);
    currentDocs = hits;
    selectedIndex = hits.length ? 0 : -1;
    renderResults(resultsBox, hits, selectedIndex);
  });

  input.addEventListener('keydown', e => {
    if (!currentDocs.length) return;

    if (e.key === 'ArrowDown'){
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % currentDocs.length;
      renderResults(resultsBox, currentDocs, selectedIndex);
    } else if (e.key === 'ArrowUp'){
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + currentDocs.length) % currentDocs.length;
      renderResults(resultsBox, currentDocs, selectedIndex);
    } else if (e.key === 'Enter'){
      e.preventDefault();
      const doc = currentDocs[selectedIndex] || currentDocs[0];
      clearResults(resultsBox);
      resetSelection();
      selectDoc(doc);
    } else if (e.key === 'Escape'){
      e.preventDefault();
      currentDocs = [];
      resetSelection();
      clearResults(resultsBox);
    }
  });

  resultsBox.addEventListener('click', e => {
    const item = e.target.closest('.search-item');
    if (!item) return;
    const idx = Array.from(resultsBox.querySelectorAll('.search-item')).indexOf(item);
    const doc = currentDocs[idx];
    clearResults(resultsBox);
    selectedIndex = -1;
    if (doc) selectDoc(doc);
  });

  document.addEventListener('click', e => {
    if (e.target === input) return;
    if (resultsBox.contains(e.target)) return;
    currentDocs = [];
    selectedIndex = -1;
    clearResults(resultsBox);
  });
}
