// The rule library of this machine (ui_state key `testDataRules`) and what the app knows
// beyond the saved project: tables being edited in open tabs.
import { getUiState, setUiState } from '../../../../../lib/middle';
import { getAllTabData } from '../../../../../lib/cache';
import { cleanRules, withOpenTabs } from './libraryOps';

export const MACHINE_KEY = 'testDataRules';

// read once and kept: a grid asks for the library in every cell
let cache = null;

export const getMachineRules = (fresh) => {
  if (!cache || fresh) {
    cache = cleanRules(getUiState(MACHINE_KEY, []));
  }
  return cache;
};

export const setMachineRules = (rules) => {
  cache = cleanRules(rules);
  setUiState(MACHINE_KEY, cache);
};

// the project as it is on screen, for counting where a rule is used
export const projectOnScreen = dataSource => withOpenTabs(dataSource, getAllTabData());
