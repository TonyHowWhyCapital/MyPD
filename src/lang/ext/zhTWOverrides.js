// Texts of the Traditional Chinese pack that the conversion from Simplified Chinese cannot
// get right by words alone; they replace the converted text of the same key.
// bin/gen-lang-zhtw.js merges the zhTW block of every file in this folder.
export default {
  zh: {},
  en: {},
  zhTW: {
    checkRule: {
      pass: '通過',
    },
    dbObject: {
      prop: {
        cycle: '循環',
      },
    },
    tableBase: {
      type: '建立方式',
    },
    tableTemplate: {
      createTable: '建立資料表程式碼',
      createView: '建立多表透視',
      createIndex: '建立索引程式碼',
    },
    modelCompare: {
      before: '目標現況',
      applyTransactional: '此資料庫的 DDL 支援交易：全部成功才提交，任一條失敗就全部還原。',
      applyUnknown: '無法確定哪些陳述式已生效，請重新比較以確認資料庫現況。',
    },
    testDataRule: {
      param: {
        header: '第一列是標題',
      },
    },
    canvas: {
      node: {
        linkAddressPlaceholder: 'https://www.example.com',
      },
    },
  },
};
