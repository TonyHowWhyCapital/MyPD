// The rule column of the field grid of a table: what a cell shows, sorts by and exports.
import { tr } from './i18n';
import { effectiveLabel } from './ruleText';
import { effectiveRule } from './libraryOps';

// name of the column in `headers` and of the property on a field
export const TEST_DATA_KEY = 'testData';

// the name of the rule in force for the column: its own, the one of its domain, or "automatic"
export const ruleCellText = (dataSource, field) => effectiveLabel(tr,
  effectiveRule(dataSource, field, field && field[TEST_DATA_KEY]));
