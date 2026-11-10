import './Math';

export const SYNC_PROPS = ['defName', 'type', 'len', 'scale', 'domain', 'baseType',
  'notNull', 'comment', 'defaultValue'];

export const ERR = {
  EMPTY_KEY: 'emptyDefKey',
  DUP_KEY: 'duplicateDefKey',
  DUP_FIELD: 'duplicateFieldDefKey',
  NOT_FOUND: 'templateNotFound',
};

const lower = (s) => `${s || ''}`.toLocaleLowerCase();

export const getEntityTemplates = (dataSource) => dataSource?.profile?.entityTemplates || [];

export const getEmptyEntityTemplate = () => ({
  id: Math.uuid(),
  defKey: '',
  defName: '',
  comment: '',
  fields: [],
});

export const validateEntityTemplate = (tpl, dataSource) => {
  const codes = [];
  const key = `${tpl?.defKey || ''}`.trim();
  if (!key) {
    codes.push(ERR.EMPTY_KEY);
  } else if (getEntityTemplates(dataSource)
    .some(t => t.id !== tpl.id && lower(t.defKey) === lower(key))) {
    codes.push(ERR.DUP_KEY);
  }
  const seen = new Set();
  const dup = (tpl?.fields || []).some((f) => {
    const k = lower(f.defKey);
    if (!k) return false;
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  });
  if (dup) codes.push(ERR.DUP_FIELD);
  return codes;
};

const withTemplates = (dataSource, entityTemplates, entities) => ({
  ...dataSource,
  ...(entities ? {entities} : {}),
  profile: {...(dataSource?.profile || {}), entityTemplates},
});

const fail = (codes) => {
  const error = new Error(codes.join(','));
  error.codes = codes;
  return error;
};

export const saveEntityTemplate = (dataSource, tpl) => {
  const codes = validateEntityTemplate(tpl, dataSource);
  if (codes.length > 0) throw fail(codes);
  const list = getEntityTemplates(dataSource);
  const exists = list.some(t => t.id === tpl.id);
  return withTemplates(dataSource,
    exists ? list.map(t => (t.id === tpl.id ? tpl : t)) : list.concat(tpl));
};

export const unlinkEntity = (entity) => {
  const {templateRef, ...rest} = entity; // eslint-disable-line no-unused-vars
  return {
    ...rest,
    fields: (entity.fields || []).map(({templateFieldId, ...f}) => f), // eslint-disable-line no-unused-vars
  };
};

export const removeEntityTemplate = (dataSource, id) => {
  const list = getEntityTemplates(dataSource);
  if (!list.some(t => t.id === id)) throw fail([ERR.NOT_FOUND]);
  const entities = (dataSource?.entities || [])
    .map(e => (e.templateRef === id ? unlinkEntity(e) : e));
  return withTemplates(dataSource, list.filter(t => t.id !== id), entities);
};

export const instantiateTemplateFields = (template, {keepLink = false} = {}) =>
  (template?.fields || []).map((f) => {
    const {templateFieldId, ...rest} = f; // eslint-disable-line no-unused-vars
    return {...rest, id: Math.uuid(), ...(keepLink ? {templateFieldId: f.id} : {})};
  });

export const createTemplateFromEntity = (entity, {defKey, defName} = {}) => ({
  id: Math.uuid(),
  defKey: defKey || '',
  defName: defName || '',
  comment: entity?.comment || '',
  fields: (entity?.fields || []).map((f) => {
    const {templateFieldId, ...rest} = f; // eslint-disable-line no-unused-vars
    return {...rest, id: Math.uuid()};
  }),
});

export const getLinkedEntities = (dataSource, templateId) =>
  (dataSource?.entities || []).filter(e => e.templateRef === templateId);

export const syncEntityWithTemplate = (entity, template) => {
  if (!template || entity.templateRef !== template.id) return entity;
  const tplFields = template.fields || [];
  const tplById = new Map(tplFields.map(f => [f.id, f]));
  const own = entity.fields || [];
  const linkedIds = new Set(own.map(f => f.templateFieldId).filter(Boolean));
  const updated = own.map((f) => {
    const src = f.templateFieldId && tplById.get(f.templateFieldId);
    if (!src) return f;
    return SYNC_PROPS.reduce((acc, p) => (
      p in src ? {...acc, [p]: src[p]} : acc), f);
  });
  const added = tplFields
    .filter(f => !linkedIds.has(f.id))
    .map(f => ({...f, id: Math.uuid(), templateFieldId: f.id}));
  return {...entity, fields: updated.concat(added)};
};

export const syncLinkedEntities = (dataSource, templateId) => {
  const template = getEntityTemplates(dataSource).find(t => t.id === templateId);
  if (!template) throw fail([ERR.NOT_FOUND]);
  return {
    ...dataSource,
    entities: (dataSource?.entities || [])
      .map(e => (e.templateRef === templateId ? syncEntityWithTemplate(e, template) : e)),
  };
};
