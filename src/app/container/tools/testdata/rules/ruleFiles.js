// Rules to a file and back, through the file windows of the system.
import React from 'react';
import { Message, Modal } from 'components';
import { saveFile, openFileOrDirPath, readNormalFile } from '../../../../../lib/middle';
import { exportRules, importRules } from '../../../../../lib/testdata/model';
import { tr } from './i18n';
import { problemText } from './ruleText';

const FILTERS = [{ name: 'JSON', extensions: ['json'] }];
const withExt = filePath => (/\.json$/i.test(filePath) ? filePath : `${filePath}.json`);

export const exportToFile = (rules) => {
  saveFile(exportRules(rules), FILTERS, withExt, {
    defaultPath: `${tr('msg.exportFile')}.json`,
  }).then(() => {
    Message.success({ title: tr('msg.exported', { count: rules.length }) });
  }).catch((err) => {
    // closing the window without a file is not a failure
    if (err && err.message) {
      Modal.error({ title: tr('msg.fileFailed'), message: err.message });
    }
  });
};

// onRules(rules) gets the rules of the file that can be used and answers how many it
// added; what cannot be used is listed
export const importFromFile = (base, onRules) => {
  openFileOrDirPath(FILTERS, ['openFile'])
    .then(filePath => readNormalFile(filePath))
    .then((data) => {
      const { rules, problems } = importRules(data.toString('utf8').replace(/^\uFEFF/, ''));
      // how many were really added: the ones already in the library are left out
      const count = rules.length > 0 ? onRules(rules) : 0;
      const items = problems.filter(p => p.index !== undefined);
      const general = problems.filter(p => p.index === undefined);
      if (problems.length === 0) {
        Message.success({
          title: rules.length > 0 && count === 0 ? tr('msg.importSame')
            : tr('msg.imported', { count }),
        });
        return;
      }
      let title = tr('msg.importFailed');
      if (rules.length > 0) {
        title = items.length > 0
          ? tr('msg.importSkipped', { count, skipped: items.length })
          : tr('msg.imported', { count });
      }
      (rules.length > 0 ? Modal.info : Modal.error)({
        title,
        message: <div className={`${base}-usage`}>
          {general.map(p => <div key={p.code}>{problemText(tr, p.code)}</div>)}
          {items.slice(0, 20).map(p => <div key={p.index}>
            {tr(p.name ? 'msg.importItemNamed' : 'msg.importItem', {
              index: p.index + 1,
              name: p.name,
              reason: problemText(tr, (p.detail && p.detail[0]) || p.code),
            })}
          </div>)}
          {rules.length === 0 && items.length > 0 && general.length === 0
            && <div>{tr('msg.importNone')}</div>}
        </div>,
      });
    })
    .catch((err) => {
      if (err && err.message) {
        Modal.error({ title: tr('msg.importFailed'), message: err.message });
      }
    });
};
