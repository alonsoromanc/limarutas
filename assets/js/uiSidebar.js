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
  const img = el('img',{
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
  const tag = el('span',{class:'tag', style:`background:${svc.color}`}, String(svc.id));
  const left = el('div',{class:'left'},
    tag,
    el('div',{},
      el('div',{class:'name'}, `Servicio ${svc.id}`),
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

function makeWrDirPairControls(chk){
  // chk.dataset.sel = 'ida' | 'vuelta'
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
    // actualizar UI
    [bIda,bVta].forEach(b=>b.classList.toggle('active', b===btn));
    // si está activado el ítem, cambiar capas visibles
    if (chk.checked){
      const ida = chk.dataset.ida, vta = chk.dataset.vuelta;
      if (sel==='ida'){ setWikiroutesVisible(ida, true, {fit:true}); setWikiroutesVisible(vta, false); }
      else            { setWikiroutesVisible(vta, true, {fit:true}); setWikiroutesVisible(ida, false); }
    }
  });

  return wrap;
}

// Item para Wikiroutes
function makeWrItem(rt){
  // rt puede ser "simple" (sin pair) o "combinado" (pair:{ida,vuelta}, defaultDir)
  const labelId = (rt.pair ? String(rt.id) : String(rt.id)).toUpperCase();
  const tag = el('span',{class:'tag', style:`background:${rt.color}`}, labelId);
  const left = el('div',{class:'left'},
    tag,
    el('div',{},
      el('div',{class:'name'}, `Wikiroutes ${labelId}`),
      el('div',{class:'sub'}, rt.name || '')
    )
  );

  const dataAttrs = rt.pair
    ? {'data-id':rt.id, 'data-system':'wr', 'data-ida':rt.pair.ida, 'data-vuelta':rt.pair.vuelta, 'data-sel':(rt.defaultDir||'ida')}
    : {'data-id':rt.id, 'data-system':'wr'};

  const chk  = el('input', Object.assign({type:'checkbox', checked:false}, dataAttrs));
  const head = el('div',{class:'item-head'}, left, chk);

  const body = rt.pair
    ? el('div',{class:'item'}, head, makeWrDirPairControls(chk))
    : el('div',{class:'item'}, head);

  chk.addEventListener('change', () => {
    if (rt.pair){
      const ida = chk.dataset.ida, vta = chk.dataset.vuelta;
      const sel = chk.dataset.sel || 'ida';
      if (chk.checked){
        if (sel==='ida'){ setWikiroutesVisible(ida, true, {fit:true}); setWikiroutesVisible(vta, false); }
        else            { setWikiroutesVisible(vta, true, {fit:true}); setWikiroutesVisible(ida, false); }
      } else {
        setWikiroutesVisible(ida, false);
        setWikiroutesVisible(vta, false);
      }
    } else {
      if (chk.checked) setWikiroutesVisible(rt.id, true, {fit:true});
      else setWikiroutesVisible(rt.id, false);
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

// Corredores agrupados
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

export function fillMetroList(){
  const sys = state.systems.metro;
  const list = sys.ui.list;
  if (!list) return;
  list.innerHTML = '';
  sys.services.forEach(s => list.appendChild(makeServiceItem('metro', s)));
}

export function fillWrList(){
  const wr = state.systems.wr;
  const list = wr.ui.list;
  if (!list) return;
  list.innerHTML = '';

  // Preferir la lista agrupada si está disponible
  const src = Array.isArray(wr.routesUi) && wr.routesUi.length ? wr.routesUi : wr.routes;
  (src || []).forEach(rt => list.appendChild(makeWrItem(rt)));
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
    // Ítem combinado Ida/Vuelta
    const ida = leafChk.dataset.ida, vta = leafChk.dataset.vuelta;
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
    // Ítem simple
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
    if (top){ top.indeterminate = checked>0 && checked<total; top.checked = total>0 && checked===total; }
  }
}

export function syncAllTri(){
  ['met','alim','corr','metro','wr'].forEach(syncTriFromLeaf);
}

export function wireHierarchy(){
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

  // Wikiroutes
  state.systems.wr.ui.chkAll.addEventListener('change', onLevel1ChangeWr);

  syncAllTri();
}
