// eslint-disable-next-line import/named
import { platform } from './middle';

let packageData;

if (platform === 'json') {
  packageData = require('../../package.json');
}


export const compareVersion = (v1 = '', v2) => {
  // 版本规范为 => x.x.x 主版本号.次版本号.小版本号
  const formatArrayStr = (data) => {
    return data.map(v => {
      const number = parseInt(v.replace(/\D/g, ''));
      return isNaN(number) ? 0 : number;
    })
  }
  const newVersions = formatArrayStr(v1.split('.'))
  const oldVersions = formatArrayStr(v2 || packageData.version.split('.'));
  const maxLength = Math.max(newVersions.length, oldVersions.length);
  let needUpdate = false;
  for (let i = 0; i < maxLength; i++) {
    if ((newVersions[i] || 0) < (oldVersions[i] || 0)) {
      break;
    } else if((newVersions[i] || 0) > (oldVersions[i] || 0)){
      needUpdate = true;
    }
  }
  return needUpdate;
};
