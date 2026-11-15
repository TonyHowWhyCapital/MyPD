// Shared by the tests of the "generate test data" window.
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import langs from '../src/lang';

export const root = path.resolve(__dirname, '..');
export const read = file => fs.readFileSync(path.join(root, file), 'utf8');
export const LANGS = ['zh', 'en', 'zhTW'];
const text = (lang, ns) => (id, data) => {
  const found = _.get(langs[lang], `${ns}.${id}`, '');
  return data && typeof found === 'string'
    ? found.replace(/\{(\w+)\}/g, (all, name) => (data[name] === undefined ? all : data[name]))
    : found;
};
export const tr = lang => text(lang, 'testData');
export const ruleTr = lang => text(lang, 'testDataRule');
export const keyPaths = (o, pre = '') => Object.keys(o).reduce((p, k) => {
  const v = o[k];
  return p.concat(v && typeof v === 'object' ? keyPaths(v, `${pre}${k}.`) : `${pre}${k}`);
}, []).sort();

// ---- a small project: USERS <- ORDERS <- ITEMS (composite key to ORDERS)
export const field = (id, more = {}) => ({
  id, defKey: id.toUpperCase(), defName: '', type: 'INT', len: '', scale: '', ...more,
});
export const project = (settings = {}) => ({
  entities: [{
    id: 'users',
    defKey: 'USERS',
    defName: 'Users',
    fields: [field('u_id', { primaryKey: true, notNull: true, autoIncrement: true }),
      field('u_name', { type: 'VARCHAR', len: 20 })],
  }, {
    id: 'orders',
    defKey: 'ORDERS',
    fields: [field('o_id', { primaryKey: true, notNull: true }),
      field('o_no', { primaryKey: true, notNull: true }),
      field('o_user', { notNull: true })],
    correlations: [{ myField: 'o_user', refEntity: 'users', refField: 'u_id' }],
  }, {
    id: 'items',
    defKey: 'ITEMS',
    fields: [field('i_id', { primaryKey: true, notNull: true }),
      field('i_order', { notNull: true }), field('i_no', { notNull: true })],
    correlations: [{ myField: 'i_order', refEntity: 'orders', refField: 'o_id' },
      { myField: 'i_no', refEntity: 'orders', refField: 'o_no' }],
  }],
  viewGroups: [{ id: 'g1', defName: 'Sales', refEntities: ['orders', 'items'] }],
  profile: { testData: { rules: [], domainRules: {}, settings } },
});
