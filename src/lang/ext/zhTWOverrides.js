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
