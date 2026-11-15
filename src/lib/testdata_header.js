// The rule column of the field grid ("test data rule") in the headers of a project.
// Projects made before the column existed do not list it: it is added when a project
// is opened, after the UI hint column, or last when that one is missing. A project that
// already lists it comes back as it is (the same object).
export const TEST_DATA_HEADER = 'testData';

const addTestDataHeader = (headers) => {
  if (!Array.isArray(headers) || headers.some(h => h && h.refKey === TEST_DATA_HEADER)) {
    return headers;
  }
  const index = headers.findIndex(h => h && h.refKey === 'uiHint');
  const next = [...headers];
  next.splice(index < 0 ? next.length : index + 1, 0, {
    refKey: TEST_DATA_HEADER,
    hideInGraph: true,
    freeze: false,
  });
  return next;
};

const listed = headers => Array.isArray(headers) && headers.length > 0;

export const ensureTestDataHeader = (dataSource) => {
  const profileHeaders = dataSource && dataSource.profile && dataSource.profile.headers;
  const entities = (dataSource && dataSource.entities) || [];
  const needProfile = listed(profileHeaders)
    && addTestDataHeader(profileHeaders) !== profileHeaders;
  const needEntity = entities.some(e => e && listed(e.headers)
    && addTestDataHeader(e.headers) !== e.headers);
  if (!needProfile && !needEntity) {
    return dataSource;
  }
  return {
    ...dataSource,
    profile: needProfile ? {
      ...dataSource.profile,
      headers: addTestDataHeader(profileHeaders)
        .map(h => (h.refKey === TEST_DATA_HEADER ? { ...h, enable: true } : h)),
    } : dataSource.profile,
    entities: needEntity ? entities.map(e => (e && listed(e.headers)
      ? { ...e, headers: addTestDataHeader(e.headers) } : e)) : entities,
  };
};
