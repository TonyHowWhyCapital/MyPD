import { createPdm } from './create';
import { applyDataSourceToPdm } from './write';

// A project remembers the PDM file its tables were imported from. The first file stays;
// importing a file of the same name again takes the newer copy.
export const rememberSource = (dataSource, name, xml) => {
  const known = dataSource.profile?.pdmSource;
  if (known?.xml && known.name !== name) {
    return dataSource;
  }
  // `covers` says how much of the file this project has read: 2 includes keys, procedures
  // and views, so one of those missing from the project was deleted there.
  return { ...dataSource, profile: { ...dataSource.profile, pdmSource: { name, xml, covers: 2 } } };
};

// The project as a PDM file. With a remembered file the project is written onto it, so
// whatever that file holds and the project does not show (procedures, extended
// attributes, the look of the diagrams...) is still there. Without one a new file is made.
export const projectToPdm = (dataSource, options = {}) => {
  const source = dataSource.profile?.pdmSource;
  if (!source?.xml) {
    return createPdm(dataSource, {
      name: dataSource.name,
      domainIds: (dataSource.domains || []).map(d => d.id),
      ...options,
    });
  }
  // The domains a project starts with are not the file's business unless a column uses one.
  const used = new Set((dataSource.entities || [])
    .reduce((all, e) => all.concat((e.fields || []).map(f => f.domain)), []));
  const file = source.xml.toUpperCase();
  const domains = (dataSource.domains || [])
    .filter(d => used.has(d.id) || file.includes(`${d.id}`.toUpperCase()));
  return applyDataSourceToPdm(source.xml, { ...dataSource, domains }, options);
};
