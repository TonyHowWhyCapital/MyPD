import _ from 'lodash';
import demo from '../src/lib/template/教学管理系统.pdma.json';
import langs from '../src/lang';
import {simplePackageChanges} from '../src/lib/datasource_version_util';
import {findChange, tableReason, fieldReason} from '../src/lib/compare_reason';

const t = ({id, data}) => `${_.get(langs.zhTW, id, `MISSING:${id}`)}`
  .replace(/\{(\w+)\}/g, (all, name) => (data && data[name] !== undefined ? data[name] : all));
const clone = () => JSON.parse(JSON.stringify(demo));
const find = (ds, key) => ds.entities.find(e => e.defKey === key);
const plain = (f, props) => Object.assign(f, {domain: '', baseType: '', ...props});
// left = model (current), right = database (pre), as in the compare list
const changesOf = (left, right) => simplePackageChanges(left, right, null, true);

describe('tableReason', () => {
  test('says which side lacks the table', () => {
    const left = clone();
    const right = clone();
    right.entities = right.entities.filter(e => e.defKey !== 'SIMS_EXAM');
    left.entities = left.entities.filter(e => e.defKey !== 'SIMS_COLLEGE');
    const changes = changesOf(left, right);
    expect(tableReason(findChange(changes, 'sims_exam'), t)).toBe('右邊沒有這張表');
    expect(tableReason(findChange(changes, 'sims_college'), t)).toBe('左邊沒有這張表');
  });

  test('summarises table attributes and field counts', () => {
    const left = clone();
    const right = clone();
    find(left, 'SIMS_COLLEGE').defName = 'New name';
    const base = find(left, 'SIMS_COLLEGE').fields[1];
    find(left, 'SIMS_COLLEGE').fields.push(plain({...base, id: 'N1', defKey: 'NEW_A'}, {type: 'INT', len: '', scale: ''}));
    find(right, 'SIMS_COLLEGE').fields.push(plain({...base, id: 'O1', defKey: 'OLD_A'}, {type: 'INT', len: '', scale: ''}));
    find(right, 'SIMS_COLLEGE').fields[2].comment = 'other';
    const reason = tableReason(findChange(changesOf(left, right), 'sims_college'), t);
    expect(reason).toBe('表的顯示名稱不同；1 個欄位只在左邊；1 個欄位只在右邊；1 個欄位定義不同');
  });

  test('is empty without a change', () => {
    expect(tableReason(undefined, t)).toBe('');
    expect(findChange([], 'x')).toBeUndefined();
  });
});

describe('fieldReason', () => {
  test('shows both types when type or length differ', () => {
    const left = clone();
    const right = clone();
    plain(find(left, 'SIMS_COLLEGE').fields[1], {type: 'VARCHAR', len: 64, scale: ''});
    plain(find(right, 'SIMS_COLLEGE').fields[1], {type: 'VARCHAR', len: 32, scale: ''});
    find(right, 'SIMS_COLLEGE').fields[1].defName = 'other';
    const key = find(left, 'SIMS_COLLEGE').fields[1].defKey.toLowerCase();
    const change = findChange(changesOf(left, right), 'sims_college');
    expect(fieldReason(change, key, t)).toBe('型別：左 VARCHAR(64)，右 VARCHAR(32)；顯示名稱不同');
  });

  test('says which side lacks the field', () => {
    const left = clone();
    const right = clone();
    const base = find(left, 'SIMS_COLLEGE').fields[1];
    find(left, 'SIMS_COLLEGE').fields.push(plain({...base, id: 'N1', defKey: 'NEW_A'}, {type: 'INT', len: '', scale: ''}));
    find(right, 'SIMS_COLLEGE').fields.push(plain({...base, id: 'O1', defKey: 'OLD_A'}, {type: 'INT', len: '', scale: ''}));
    const change = findChange(changesOf(left, right), 'sims_college');
    expect(fieldReason(change, 'new_a', t)).toBe('右邊沒有這個欄位');
    expect(fieldReason(change, 'old_a', t)).toBe('左邊沒有這個欄位');
    expect(fieldReason(change, 'college_id', t)).toBe('');
  });

  test('every reason text exists in each language', () => {
    ['zh', 'en', 'zhTW'].forEach((lang) => {
      const ids = ['diffReasonCol', 'reasonTableOnlyLeft', 'reasonTableOnlyRight', 'reasonTableAttrs',
        'reasonFieldsOnlyLeft', 'reasonFieldsOnlyRight', 'reasonFieldsModified', 'reasonFieldOnlyLeft',
        'reasonFieldOnlyRight', 'reasonFieldType', 'reasonAttrs'];
      expect(ids.filter(id => _.get(langs[lang], `components.compare.${id}`) === undefined)).toEqual([]);
    });
  });
});
