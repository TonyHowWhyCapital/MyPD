import { defaultConn, dbToFollow, withDefaultDb } from '../src/lib/conn_db';

const project = (db, dbConn = '') => ({
  profile: {
    default: { db, dbConn },
    dataTypeSupports: [{ id: 'my', defKey: 'MYSQL' }, { id: 'ms', defKey: 'SQLServer' }],
  },
  dbConn: [{ defKey: 'c1', type: 'ms' }, { defKey: 'c2', type: 'my' }],
});

test('the default connection is the one the project names', () => {
  expect(defaultConn(project('my', 'c1')).type).toBe('ms');
  expect(defaultConn(project('my'))).toBeUndefined();
});

test('a connection of another database type is followed', () => {
  expect(dbToFollow(project('my'), { type: 'ms' }).defKey).toBe('SQLServer');
});

test('nothing to follow for the same type, an unknown type or no connection', () => {
  expect(dbToFollow(project('ms'), { type: 'ms' })).toBe('');
  expect(dbToFollow(project('my'), { type: 'other' })).toBe('');
  expect(dbToFollow(project('my'), undefined)).toBe('');
});

test('the new type is set without touching the rest of the defaults', () => {
  const next = withDefaultDb(project('my', 'c1'), 'ms');
  expect(next.profile.default).toEqual({ db: 'ms', dbConn: 'c1' });
});
