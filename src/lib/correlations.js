import {separator} from '../../profile';

// 关系图上的连线与数据表上的关联（correlations）之间的换算。
// 存档时由项目里的全部关系图重算，不再只看打开着的那几张图。

const fieldOf = (end) => {
  const raw = (end && (end.portOrigin || end.port)) || '';
  return `${raw}`.split(separator)[0];
};

const erRelation = ['n', '0,1', '0,n', '1', '1,n', '0'];

// cellsList: [cells] — the cells of every diagram, saved form or tab form alike
export const diagramCorrelations = (cellsList) => {
  return (cellsList || []).reduce((a, cells) => {
    const all = cells || [];
    const tables = all.filter(c => c.shape === 'table');
    const entityOf = id => (tables.find(t => t.id === id) || {}).originKey;
    return a.concat(all.filter(c => c.shape === 'erdRelation').map((cell) => {
      const relation = (cell.relation || '').split(':');
      const status = erRelation.includes(relation[0]);
      const my = status ? cell.source : cell.target;
      const ref = status ? cell.target : cell.source;
      const myEntity = entityOf(my && my.cell);
      const refEntity = entityOf(ref && ref.cell);
      if (!myEntity || !refEntity) {
        return null;
      }
      return {
        myEntity,
        myField: fieldOf(my),
        refEntity,
        refField: fieldOf(ref),
        myRows: (status ? relation[0] : relation[1]) || '',
        refRows: (status ? relation[1] : relation[0]) || '',
        innerType: '',
      };
    }).filter(c => !!c));
  }, []);
};

const keyOf = (entity, c) => `${entity}|${c.myField}|${c.refEntity}|${c.refField}`;
const reverseKeyOf = (entity, c) => `${c.refEntity}|${c.refField}|${entity}|${c.myField}`;

// entities: the tables to update; before / after: what the diagrams drew before and after
// this save. A relation that was drawn before and is not drawn now was removed by the user.
// A relation that no diagram ever drew (for example one read from a PDM file) is kept.
export const mergeCorrelations = (entities, before, after) => {
  const drawnBefore = new Set((before || []).map(c => keyOf(c.myEntity, c)));
  const drawnAfter = new Set();
  (after || []).forEach((c) => {
    drawnAfter.add(keyOf(c.myEntity, c));
    drawnAfter.add(reverseKeyOf(c.myEntity, c));
  });
  return (entities || []).map((e) => {
    const seen = new Set();
    const unique = (c) => {
      const key = keyOf(e.id, c);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    };
    const drawn = (after || []).filter(c => c.myEntity === e.id).map((c) => {
      const {myEntity, ...rest} = c;
      return rest;
    });
    const kept = (e.correlations || []).filter((c) => {
      const key = keyOf(e.id, c);
      return !drawnBefore.has(key) && !drawnAfter.has(key);
    });
    return {
      ...e,
      correlations: drawn.concat(kept).filter(unique),
    };
  });
};

export const cellsOfDiagrams = diagrams => (diagrams || [])
  .map(d => (d && d.canvasData && d.canvasData.cells) || []);
