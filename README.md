# 一、项目说明

本仓库为 **PDManer 元数建模 v4.9.3** 的 **最后发行版本源码存档**。  
由于官方已升级至新版本且旧版本安装包无法下载，因此将源码备份于此，方便有需要的用户自行编译使用。  

PDManer 是一款多操作系统、开源免费的桌面版关系数据库建模工具，界面简洁美观，操作简单，上手容易，支持 Windows、Mac、Linux 及国产操作系统。  

支持的数据库包括：
- MySQL、PostgreSQL、Oracle、SQLServer 等常见数据库  
- 达梦、GuassDB 等国产数据库  
- Hive、MaxCompute 等大数据方向数据库  
- 用户可自行扩展更多数据库类型  

本产品基于 **ES6 + React + Electron + Java** 构建。  

---

# 二、主要功能

- **数据表管理**：表、字段、注释、索引等  
- **视图管理**：多表多字段组合视图，支持生成 DDL 及 Java DTO  
- **ER 关系图**：绘制 ER 图及高阶抽象模型  
- **数据字典**：代码映射表管理，并与数据表字段关联  
- **数据类型**：支持基础数据类型与数据域，用户可自定义  
- **多数据库支持**：内置主流数据库，支持自定义扩展  
- **代码生成**：内置 Java / MyBatis / MyBatisPlus / C# 等代码生成，可扩展 Python 等  
- **版本管理**：数据表版本管理与增量 DDL 生成  
- **生态对接**：支持导入 PowerDesigner PDM、旧版 PDMan 文件，支持导出 Word 文档等  
- **影响分析**：删除数据表、删除字段或修改字段类型前预览受影响的对象，并可保存为影响分析模型以便回顾（快捷工具 → 影响分析；删除数据表的确认框也会列出受影响对象）  
- **模型对比与合并**：当前项目、项目文件、数据库三者任选两方逐对象比对，勾选差异后生成 ALTER 脚本或合并到当前项目（快捷工具 → 模型对比与合并）  
- **数据库对象**：触发器、存储过程/函数、序列、分区、表空间、同义词、权限建模，并可随 DDL 导出（快捷工具 → 数据库对象）  
- **报表**：可设计报表模板，跨多个模型生成文档式或清单式报表，输出 Word / HTML / Markdown / CSV（快捷工具 → 报表）  
- **数据表模板**：定义可重复使用的预设字段集合，新建数据表时可选用并可保持与模板的关联（快捷工具 → 数据表模板）  
- **界面语言**：简体中文、繁體中文、English（设置 → 语言，默认跟随系统）  
- **完全离线**：已移除自动更新、版本检查、访问统计、云端版本入口与远程读取功能，窗口内的非本地网络请求一律拦截；仅在用户自行配置数据库连接时由 Java 引擎连接该数据库  

---

# 三、如何编译

如需本地编译本版本，请参考这篇详细教程：  
🔗 [PDManer 旧版本手动编译安装包全记录](https://www.bytezonex.com/archives/pdmaner-old-version-build-guide.html)

---

## macOS 本地编译与运行

已在 macOS（Apple Silicon）、Node.js 20、Java 17 下验证。

```bash
npm install --legacy-peer-deps      # 安装依赖
(cd app && npm install)             # 打包时所需的运行期依赖
npm run build                       # 编译前端到 app/build
npx electron app                    # 直接运行（若环境变量 ELECTRON_RUN_AS_NODE 已设置需先取消）
npm run package-mac                 # 生成 dist 下的 dmg（arm64 与 x64）
npm test                            # 运行自动化测试
npm run lang:zhTW                   # 修改简体语言包后重新生成繁体语言包
```

数据库连接、逆向解析、Excel/旧版 Word 导出依赖 Java 引擎 `pdmaner-java.jar`，本仓库不包含该文件。
请从[官方仓库](https://gitee.com/robergroup/pdmaner)的 `public/jar/pdmaner-java.jar` 取得（或自行编译 chiner-java），放到 `public/jar/` 后再执行 `npm run build`。
未放置该文件时，其余功能（含新增的影响分析、模型文件对比、数据库对象、报表）仍可使用。

---

# 四、特别说明

1. 本仓库源码仅用于学习与历史存档，不再进行功能更新  
2. 编译需具备一定前端开发基础（React / Electron / Node.js）  
3. 安装包请自行编译生成，本仓库不直接提供成品安装包  
4. 欢迎提交 PR 修复问题或改进文档  
5. Java 部分代码参考：[chiner-java](https://gitee.com/robergroup/chiner-java)  

---

# 五、相关资源

- [官方 PDManer 新版本](https://gitee.com/robergroup/pdmaner)
- [操作手册 - 语雀版](https://www.yuque.com/pdmaner/docs)
- [OSChina PDMan 专栏](https://my.oschina.net/skymozn?tab=newest&catalogId=5775221&sortType=time)

---
