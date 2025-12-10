// config.js
export const PATHS = {
  data:  'data',
  met:   'data/processed/metropolitano',
  corr:  'data/processed/corredores',
  metro: 'data/processed/metro',
  wr:    'data/processed/transporte',
  icons: {
    met:   'assets/icons/metropolitano',
    corr:  'assets/icons/corredores',
    metro: 'assets/icons/metro'
  }
};

export const COLOR_AN = '#FF4500';  // Alimentadores Norte
export const COLOR_AS = '#FFCD00';  // Alimentadores Sur

export const state = {
  map: null,
  baseLayers: { light: null, dark: null },
  currentBase: 'light',

  // Opciones
  dir: 'ambas',
  showStops: true,
  autoFit: true,

  // Catálogo
  catalog: null,

  // Dirección por ruta
  routeDir: new Map(),

  systems: {
    met:   { id:'met',   label:'Metropolitano', stops:null, services:[], lineLayers:new Map(), stopLayers:new Map(), ui:{ listReg:null, listExp:null, chkAll:null, chkReg:null, chkExp:null } },
    alim:  { id:'alim',  label:'Alimentadores', stops:new Map(), services:[], lineLayers:new Map(), stopLayers:new Map(), ui:{ listN:null, listS:null, chkAll:null, chkN:null, chkS:null } },
    corr:  { id:'corr',  label:'Corredores',    stops:new Map(), services:[], lineLayers:new Map(), stopLayers:new Map(), ui:{ list:null, chkAll:null, groups:new Map() } },
    metro: { id:'metro', label:'Metro',         stops:new Map(), services:[], lineLayers:new Map(), stopLayers:new Map(), ui:{ list:null, chkAll:null } },

    // Wikiroutes (Transporte público)
    wr: {
      id:'wr',
      label:'Transporte público',
      routes: [],
      layers: new Map(),       // id -> L.LayerGroup
      stopLayers: new Map(),   // id -> L.LayerGroup (paraderos)
      bounds: new Map(),       // id -> LatLngBounds
      ui:{ list:null, chkAll:null }
    }
  },

  bulk: false,
  _searchIndex: []
};

export const keyFor = (systemId, id) =>
  `${systemId}:${String(id).toUpperCase()}`;

export const getDirFor = (systemId, id) =>
  state.routeDir.get(keyFor(systemId,id)) || 'ambas';

export const setDirFor = (systemId, id, dir) =>
  state.routeDir.set(keyFor(systemId,id), dir);
