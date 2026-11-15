import { isNewer, parseRelease, RELEASE_REPO, RELEASE_PAGE } from '../src/lib/update_check';

test('a version is newer only when a number further left is larger', () => {
  expect(isNewer('1.0.1', '1.0.0')).toBe(true);
  expect(isNewer('v1.1.0', '1.0.9')).toBe(true);
  expect(isNewer('2.0', '1.9.9')).toBe(true);
  expect(isNewer('1.0.10', '1.0.9')).toBe(true);
  expect(isNewer('1.0.0', '1.0.0')).toBe(false);
  expect(isNewer('1.0', '1.0.0')).toBe(false);
  expect(isNewer('0.9.9', '1.0.0')).toBe(false);
  expect(isNewer('1.5.0', '2.0.0')).toBe(false);
});

test('the release answer gives version, link and whether it is newer', () => {
  const page = `https://github.com/${RELEASE_REPO}/releases/tag/v1.2.0`;
  expect(parseRelease({tag_name: 'v1.2.0', html_url: page}, '1.0.0'))
    .toEqual({version: '1.2.0', url: page, newer: true});
  expect(parseRelease({tag_name: '1.0.0', html_url: page}, '1.0.0').newer).toBe(false);
});

test('a link that leaves the releases repository is replaced', () => {
  const release = parseRelease({tag_name: 'v9.0.0', html_url: 'https://example.com/x'}, '1.0.0');
  expect(release.url).toBe(RELEASE_PAGE);
  const similar = `https://github.com/${RELEASE_REPO}-evil/releases/tag/v9`;
  expect(parseRelease({tag_name: 'v9.0.0', html_url: similar}, '1.0.0').url).toBe(RELEASE_PAGE);
});

test('an answer without a usable version is ignored', () => {
  expect(parseRelease({}, '1.0.0')).toBe(null);
  expect(parseRelease(null, '1.0.0')).toBe(null);
  expect(parseRelease({tag_name: 'nightly'}, '1.0.0')).toBe(null);
  expect(parseRelease({tag_name: '<script>'}, '1.0.0')).toBe(null);
});

test('the installer and the page carry the same version number', () => {
  // the installer takes its number from app/package.json, the home page from package.json
  // eslint-disable-next-line global-require
  expect(require('../app/package.json').version).toBe(require('../package.json').version);
});
