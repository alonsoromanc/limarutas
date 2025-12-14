// uiSidebar.js
// Fachada: re-exporta funciones desde módulos por sistema.

export { fillMetList, fillAlimList, fillMetroList } from './uiSidebar.systems.js';
export { fillCorrList } from './uiSidebar.corr.js';
export { fillWrList, fillAeroList, fillOtrosList } from './uiSidebar.wr.js';

export {
  bulk,
  routeCheckboxesOf,
  setLeafChecked,
  setLevel2Checked,
  syncTriFromLeaf,
  syncAllTri,
  wireHierarchy,
  onLevel1ChangeCorr,
  onLevel1ChangeMetro,
  onLevel1ChangeWr,
  onLevel1ChangeWrAero,
  onLevel1ChangeWrOtros
} from './uiSidebar.hierarchy.js';
