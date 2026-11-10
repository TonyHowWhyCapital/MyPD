import {connectDB} from '../../../../lib/middle';

const CHUNK = 15;
const request = (dataSource, config, properties, command) => new Promise((resolve, reject) => {
  connectDB(dataSource, config, properties, command, (data) => {
    if (data.status === 'FAILED') reject(data);
    else resolve(data.body);
  });
});

const splitName = d => ({
  defName: d?.defName?.split(';')[0] || '',
  comment: d.comment || d?.defName?.split(';')[1] || '',
});

// Same jar commands as the model-vs-database screen. Rejects with {body} on failure.
export const loadDbSnapshot = async (dataSource, config, conn, onProgress) => {
  const tables = await request(dataSource, config, conn.properties, 'DBReverseGetAllTablesList');
  const entities = [];
  for (let i = 0; i < tables.length; i += CHUNK) {
    onProgress && onProgress(i, tables.length);
    // eslint-disable-next-line no-await-in-loop
    const body = await request(dataSource, config, {
      ...conn.properties,
      tables: tables.slice(i, i + CHUNK).map(t => t.defKey).join(','),
    }, 'DBReverseGetTableDDL');
    body.forEach((d) => {
      const meta = tables.find(t => t.defKey === d.defKey) || {};
      const fields = (d.fields || []).map(f => ({...f, id: Math.uuid(), ...splitName(f)}));
      entities.push({
        ...d,
        ...splitName(meta),
        fields,
        indexes: (d.indexes || []).map(idx => ({
          ...idx,
          id: Math.uuid(),
          fields: (idx.fields || []).map(f => ({
            ...f,
            id: Math.uuid(),
            fieldDefKey: fields.find(x => x.defKey.toLocaleLowerCase()
              === `${f.fieldDefKey}`.toLocaleLowerCase())?.id || f.fieldDefKey,
          })),
        })),
      });
    });
  }
  const profile = dataSource.profile || {};
  return {
    ...dataSource,
    profile: {
      ...profile,
      default: {...(profile.default || {}), db: conn.type || profile.default?.db},
    },
    entities,
  };
};
