import _ from 'lodash';
import './Math';
import {_getTemplateString} from './utils';
import {dbObjectTypes} from './dbobject_templates';

export {dbObjectTypes};

// defKey of dataTypeSupports (lower case) -> dialect with its own templates
const DIALECTS = {
  mysql: 'mysql', mariadb: 'mysql', doris: 'mysql',
  oracle: 'oracle', dm: 'oracle',
  postgresql: 'postgresql', gaussdb: 'postgresql', kingbase: 'postgresql', highgo: 'postgresql',
  sqlserver: 'sqlserver',
};

export const getDbObjectTypeList = () => Object.keys(dbObjectTypes);

export const getEmptyDbObject = (type) => {
  const def = dbObjectTypes[type];
  if (!def) {
    throw new Error(`unknown db object type: ${type}`);
  }
  return {
    id: Math.uuid(),
    type,
    defKey: '',
    defName: '',
    comment: '',
    refEntity: '',
    props: _.cloneDeep(def.defaultProps),
    body: '',
    customDDL: '',
  };
};

const findEntity = (dataSource, id) => {
  return (dataSource?.entities || []).concat(dataSource?.views || []).find(e => e.id === id);
};

export const validateDbObject = (obj, dataSource) => {
  const codes = [];
  const def = dbObjectTypes[obj?.type];
  if (!obj?.defKey || !`${obj.defKey}`.trim()) {
    codes.push('emptyDefKey');
  }
  if (!def) {
    codes.push('unknownType');
  }
  const key = `${obj?.defKey || ''}`.trim().toLowerCase();
  if (key && (dataSource?.dbObjects || []).some(o => o.id !== obj.id
    && o.type === obj.type && `${o.defKey}`.trim().toLowerCase() === key)) {
    codes.push('duplicate');
  }
  if (def) {
    if (!obj.refEntity) {
      def.needsEntity && codes.push('missingEntity');
    } else if (!findEntity(dataSource, obj.refEntity)) {
      codes.push('unknownEntity');
    }
  }
  return codes;
};

const throwIfInvalid = (obj, dataSource) => {
  const codes = validateDbObject(obj, dataSource);
  if (codes.length) {
    const error = new Error(`invalid db object: ${codes.join(',')}`);
    error.codes = codes;
    throw error;
  }
};

export const addDbObject = (dataSource, obj) => {
  const object = {...obj, id: obj.id || Math.uuid()};
  throwIfInvalid(object, dataSource);
  return {...dataSource, dbObjects: (dataSource.dbObjects || []).concat(object)};
};

export const updateDbObject = (dataSource, obj) => {
  const list = dataSource.dbObjects || [];
  if (!list.some(o => o.id === obj.id)) {
    const error = new Error('db object not found');
    error.codes = ['notFound'];
    throw error;
  }
  throwIfInvalid(obj, dataSource);
  return {...dataSource, dbObjects: list.map(o => (o.id === obj.id ? obj : o))};
};

export const removeDbObject = (dataSource, id) => {
  return {...dataSource, dbObjects: (dataSource.dbObjects || []).filter(o => o.id !== id)};
};

export const getDbObjectsByEntity = (dataSource, entityId) => {
  return (dataSource?.dbObjects || []).filter(o => o.refEntity === entityId);
};

const str = (v) => (v === undefined || v === null ? '' : `${v}`);

const getDialect = (dataSource, dbId) => {
  const support = (dataSource?.profile?.dataTypeSupports || []).find(s => s.id === dbId);
  const name = str(support?.defKey || dbId).toLowerCase();
  return {dialect: DIALECTS[name] || 'default', dbName: support?.defKey || str(dbId)};
};

const buildProps = (def, props) => {
  const merged = {...def.defaultProps, ...props};
  return _.mapValues(merged, (v) => (Array.isArray(v) || typeof v === 'boolean' ? v : str(v)));
};

// Values the templates need but a registry cannot express as plain props.
const buildTemplateData = (obj, entity, dataSource, def) => {
  const props = buildProps(def, obj.props);
  const fieldName = (id) => entity?.fields?.find(f => f.id === id)?.defKey || id;
  const events = props.events || [];
  const params = props.params || [];
  const partitions = props.partitions || [];
  const privileges = props.privileges || [];
  const columnNames = (props.columns || []).map(fieldName).join(', ');
  const paramText = (fn) => params.filter(p => p.name).map(fn).join(', ');
  const object = {
    ...obj,
    props,
    body: str(obj.body),
    columnNames,
    eventList: events.join(' OR '),
    eventListComma: events.join(', '),
    triggerNames: events.map(e => ({
      event: e,
      name: events.length > 1 ? `${obj.defKey}_${e.toLowerCase()}` : obj.defKey,
    })),
    fnName: `${obj.defKey}_fn`,
    privilegeList: privileges.join(', '),
    paramsPlain: paramText(p => `${p.name} ${str(p.type)}`),
    paramsMode: paramText(p => `${p.mode || 'IN'} ${p.name} ${str(p.type)}`),
    paramsOracle: paramText(p => `${p.name} ${p.mode || 'IN'} ${str(p.type)}`),
    paramsAt: paramText(p => `@${p.name} ${str(p.type)}${p.mode === 'OUT' || p.mode === 'INOUT' ? ' OUTPUT' : ''}`),
    partitionCount: partitions.length,
    partitionList: partitions.map((p, index) => ({
      index,
      name: p.name,
      values: str(p.values),
      lower: index === 0 ? 'MINVALUE' : str(partitions[index - 1].values),
      comma: index < partitions.length - 1 ? ',' : '',
    })),
    target: entity?.defKey || props.targetName,
  };
  return {object, entity: {...entity, defKey: entity?.defKey || ''}};
};

const trimDdl = (text) => str(text).replace(/^\s+|\s+$/g, '');

export const getDbObjectDDL = (obj, dataSource, dbId, kind = 'create') => {
  const def = dbObjectTypes[obj?.type];
  if (!def) {
    return `-- unknown database object type: ${obj?.type}`;
  }
  if (kind === 'create' && trimDdl(obj.customDDL)) {
    return trimDdl(obj.customDDL);
  }
  const {dialect, dbName} = getDialect(dataSource, dbId);
  const tpl = def.templates[dialect] || def.templates.default;
  if (tpl.unsupported) {
    return `-- ${obj.type} is not supported by ${dbName}`;
  }
  const entity = findEntity(dataSource, obj.refEntity);
  const data = buildTemplateData(obj, entity, dataSource, def);
  const separator = _.get(dataSource, 'profile.sql.delimiter') || ';';
  return trimDdl(_getTemplateString(tpl[kind === 'drop' ? 'drop' : 'create'], {...data, separator}));
};

export const getAllDbObjectsDDL = (dataSource, dbId, {types, ids, withDrop} = {}) => {
  const order = getDbObjectTypeList();
  const list = (dataSource?.dbObjects || [])
    .filter(o => dbObjectTypes[o.type]
      && (!types || types.includes(o.type)) && (!ids || ids.includes(o.id)))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return list.map((o) => {
    const create = getDbObjectDDL(o, dataSource, dbId, 'create');
    return withDrop ? `${getDbObjectDDL(o, dataSource, dbId, 'drop')}\n${create}` : create;
  }).join('\n\n');
};
