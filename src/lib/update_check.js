// The only place where the app opens a network connection by itself: it asks the public
// releases repository for the number of the latest version. Nothing about the user or the
// project is sent. A newer version is only announced; downloading and installing stay manual.
export const RELEASE_REPO = 'TonyHowWhyCapital/MyPD-releases';
export const RELEASE_HOST = 'api.github.com';
export const RELEASE_PAGE = `https://github.com/${RELEASE_REPO}/releases/latest`;

const numbers = version => `${version || ''}`.replace(/^[^\d]*/, '').split('.')
  .map(part => parseInt(part, 10) || 0);

export const isNewer = (latest, current) => {
  const a = numbers(latest);
  const b = numbers(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) {
      return (a[i] || 0) > (b[i] || 0);
    }
  }
  return false;
};

// What the page needs from the answer of the releases API. The link is taken from the
// answer only when it points into the releases of this repository.
export const parseRelease = (release, current) => {
  const tag = `${(release && release.tag_name) || ''}`.trim();
  if (!/^v?\d+(\.\d+)*$/.test(tag)) {
    return null;
  }
  const page = `${(release && release.html_url) || ''}`;
  const own = page.indexOf(`https://github.com/${RELEASE_REPO}/releases/`) === 0;
  return {
    version: tag.replace(/^v/, ''),
    url: own ? page : RELEASE_PAGE,
    newer: isNewer(tag, current),
  };
};

export const fetchLatestRelease = (current, timeout = 8000) => new Promise((res, rej) => {
  // eslint-disable-next-line global-require
  const request = require('https').get({
    host: RELEASE_HOST,
    path: `/repos/${RELEASE_REPO}/releases/latest`,
    headers: {'User-Agent': 'MyPD', Accept: 'application/vnd.github+json'},
    timeout,
  }, (response) => {
    if (response.statusCode !== 200) {
      response.resume();
      rej(new Error(`HTTP ${response.statusCode}`));
      return;
    }
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy(new Error('answer too large'));
      }
    });
    response.on('end', () => {
      try {
        const release = parseRelease(JSON.parse(body), current);
        if (release) {
          res(release);
        } else {
          rej(new Error('no version in the answer'));
        }
      } catch (err) {
        rej(err);
      }
    });
  });
  request.on('timeout', () => request.destroy(new Error('timeout')));
  request.on('error', rej);
});

// opens the download page in the browser of the system
export const openReleasePage = (url) => {
  const own = `${url || ''}`.indexOf(`https://github.com/${RELEASE_REPO}/releases/`) === 0;
  // eslint-disable-next-line global-require
  return require('electron').shell.openExternal(own ? url : RELEASE_PAGE);
};
