// The database type of a project follows the connection it works with.

export const defaultConn = (dataSource) => {
  const key = dataSource?.profile?.default?.dbConn;
  return (dataSource?.dbConn || []).find(c => c.defKey === key);
};

// The database type to switch to, or '' when the project already has the type of the
// connection or does not know it.
export const dbToFollow = (dataSource, conn) => {
  const type = conn?.type;
  const support = (dataSource?.profile?.dataTypeSupports || []).find(s => s.id === type);
  return support && type !== dataSource.profile?.default?.db ? support : '';
};

export const withDefaultDb = (dataSource, db) => ({
  ...dataSource,
  profile: {
    ...dataSource.profile,
    default: { ...dataSource.profile?.default, db },
  },
});
