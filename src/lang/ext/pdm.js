export default {
  zh: {
    pdm: {
      saveTitle: '写回 PDM 文件',
      reverseToPdm: '从数据库逆向生成 PDM 文件',
      created: '已生成 PDM 文件（{count} 张表）：{path}',
      createFail: '生成 PDM 文件失败',
      addToProjectTitle: '加入当前项目',
      addToProject: '已生成 PDM 文件（{count} 张表）：\n{path}\n\n是否同时把这些数据表加入当前项目？',
      saveConfirm: '保存将直接修改此 PDM 文件，原文件会先备份为同目录下的 .bak 文件。\n只会写入数据表、字段、主键、索引、数据域的变更；关系线、关系图布局、视图、数据字典及其他内容不会写入 PDM 文件。\n如需保留全部内容，请使用“另存为”保存为项目文件。',
    },
  },
  en: {
    pdm: {
      saveTitle: 'Write back to the PDM file',
      reverseToPdm: 'Reverse a database into a PDM file',
      created: 'PDM file created ({count} tables): {path}',
      createFail: 'Could not create the PDM file',
      addToProjectTitle: 'Add to the current project',
      addToProject: 'PDM file created ({count} tables):\n{path}\n\nAlso add these tables to the current project?',
      saveConfirm: 'Saving modifies this PDM file in place. The original is first backed up as a .bak file in the same folder.\nOnly changes to tables, columns, primary keys, indexes and domains are written. Relation lines, diagram layout, views, dictionaries and other content are not written to the PDM file.\nUse "Save As" to keep everything in a project file.',
    },
  },
};
