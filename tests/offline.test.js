import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).reduce((p, d) => {
  const full = path.join(dir, d.name);
  if (d.isDirectory()) {
    return d.name === 'template' ? p : p.concat(walk(full));
  }
  return /\.(js|html)$/.test(d.name) ? p.concat(full) : p;
}, []);
const sources = walk(path.join(root, 'src')).concat(path.join(root, 'public/index.html'))
  .map(file => ({file: path.relative(root, file), text: fs.readFileSync(file, 'utf8')}));
const offenders = pattern => sources.filter(s => pattern.test(s.text)).map(s => s.file);

test('the app contains no code that opens a network connection by itself', () => {
  expect(offenders(/require\(['"](http|https|net|tls|dgram)['"]\)|from ['"](http|https|net)['"]/)).toEqual([]);
  expect(offenders(/XMLHttpRequest|sendBeacon|new WebSocket|[^\w.]fetch\(/)).toEqual([]);
  expect(offenders(/autoUpdater|electron-updater|checkForUpdates/)).toEqual([]);
});

test('no analytics, update, or vendor cloud endpoints remain', () => {
  expect(offenders(/hm\.baidu\.com|pdmaas\.pdmaner\.com|pdman\.cn|httpchk\.com|yuque\.com|HttpParser/)).toEqual([]);
});

test('the main process blocks every non-local request from the window', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  expect(main).toMatch(/webRequest\.onBeforeRequest/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  expect(pkg.build.publish).toBeUndefined();
});
