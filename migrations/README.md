# 本地优化与线上迁移准备

第一阶段只升级本地数据层，并提供离线迁移工具。网页仍在 GitHub Pages，论文数据没有上传；这里的 SQL 尚未应用到任何云项目。第二阶段采用 Supabase 时沿用这些格式和表结构。

## 已完成的本地升级

- 主存储改为 IndexedDB：每篇论文一条记录，设置与修订号单独保存；星标只写对应论文。事务完成后才更新界面，失败保留上次状态并显示持续提示。
- 首次打开读取旧 `summarize-paper-library-v2`，其次 v1，并原样保留旧键作为升级前副本；只在新数据库未初始化时读取旧数据，空库也不会反复“复活”旧记录。原始文件与旧存储不会删除。
- 不支持 IndexedDB 的环境使用紧凑 JSON 兼容存储；此模式仍需整库写入，有浏览器容量限制。IndexedDB 打开失败时停止写入，不另建一个空库遮住已有数据。
- 多标签页通过 BroadcastChannel 通知，写入检查库修订号；过期写入被拒绝并刷新，避免覆盖另一标签页的修改。兼容存储尽可能使用 Web Locks；不支持 Web Locks 时不保证跨标签页竞争写入，建议只开一个页面。
- 新论文和引用记录使用持久编号；旧论文编号保留。元数据更新会匹配原记录编号。无法可靠判断对应关系时保留独立条目，并报告无法应用的历史合并，不猜测。
- 文献搜索缓存论文级引用文本；分析缓存随数据/设置版本失效，星标与页面导航不重算引用。点击排名只更新选择详情；合并候选在展开时创建。
- 文件夹仍每 5 秒扫描文件信息，只有首选总结或同组 Markdown 变化才读取和解析该组。成功保存后才记录缓存；解析失败会重试。删除磁盘文件不会自动删除库内论文，保持原有行为。

## 使用与恢复

1. 在原来使用的浏览器、原网页地址打开新版页面，旧库自动升级。其他浏览器或不同网址无法访问原浏览器存储。
2. “导出库”生成 `format: summarize-paper-library`、`schema_version: 3` 的完整备份，包括星标、引用原文和分析设置。单篇 skill 输出仍使用自己的 schema 版本，两者互不替代。
3. “导出迁移包”生成关系表格式，保留所有原始总结和引用语境，不重复附带一份整库 JSON。导出会核对记录编号、外键、文献归属、方向和不同来源论文计数。
4. 两种导出都能通过文件导入或粘贴 JSON 恢复。导入沿用合并方式，不会清除库中其他论文。需要在空库做完整恢复时，先单独备份现库，再明确执行清空和导入。
5. 保留库备份、迁移包和原始 skill 文件直到云端核对通过。浏览器存储仍可能被清理，升级前副本仅供本机恢复，不能代替独立备份。

## 离线迁移演练

使用网页新版导出的完整库或迁移包：

```bash
node scripts/prepare-migration.cjs /path/to/library.json /path/to/new-migration.json
node scripts/prepare-migration.cjs /path/to/new-migration.json
```

命令只读取本地文件、校验数据并按需写出新文件，不联网，不覆盖现有输出。不含稳定引用编号的旧备份，应先导入新版网页再导出。论文内容、迁移包和数据库密钥不要提交到代码仓库。

迁移包的六张表：

| 表名 | 内容 |
|---|---|
| `papers` | 持久论文 ID、排序和总结内容；引用分组单独存储 |
| `sources` | 统计意义上的去重来源论文 |
| `source_members` | 原始论文记录到去重来源的映射 |
| `works` | 去重后的被引文献及成员编号 |
| `reference_groups` | 每篇论文原始方向名称、说明和顺序 |
| `citation_records` | 每条原始引用、稳定记录 ID、出处、关系与分类依据；关联来源与被引文献 |

`analysis_settings` 包含方向映射、可撤销的合并规则和历史标识映射；它在云端放入 `paper_library_state`。一个来源对同一文献的多个编号或方向仍分别保留，统计使用 `COUNT(DISTINCT source_id)`。

## 第二阶段的接入约定

应用通过异步 repository 边界访问存储：

```text
read() -> { schema_version: 3, revision, papers, analysis_settings }
commit({ expectedRevision, puts, deletes, settings? }) -> newRevision
subscribe(callback) -> unsubscribe
close()
```

`commit` 必须以事务原子保存论文、设置与修订号；冲突返回 `revision_conflict`，不能静默覆盖。星标更新单条记录。云端适配器应增加论文分页和按需详情读取，引用排行调用 SQL 聚合，不能在每次操作后重新下载整库。

实际迁移阶段还需要：

1. 选择并创建 Supabase 项目、确定登录账户，实际验证访问该区域的网络；这一步当前未执行。
2. 在空目标项目运行 `001_supabase.sql`。SQL 建立复合外键、索引、按账户隔离的 RLS 及分页排名函数。使用真实 Supabase 的 `auth.users` 与 `auth.uid()`，不能把测试中的 auth 替身部署上去。
3. 实现登录和云端 repository：客户端仅放项目 URL 与 publishable key；所有表的 owner 由当前登录身份绑定。管理员密钥不能进入网页。提交需在数据库事务/RPC 内检查修订号，防止多设备覆盖。
4. 校验迁移包，在同一事务内按 `papers → sources → source_members → works → reference_groups → citation_records → state` 写入。实际表名为 `paper_library_` 加包内表名；owner_id 使用当前用户 ID，不信任文件中提供的账户值。
5. 对比论文数、被引文献数、引用记录数、去重边数、方向排行、星标、语境和合并/撤销结果。相同计数的条目按数据库排序规则排序，若需与浏览器逐项一致，接入时统一排序规则。
6. 确认后切换读取来源，保留本地缓存和备份。同步失败应保留未同步操作及重试状态；删除应带修订号/删除记录，避免旧设备把已删除数据重新上传。

这些连接、登录、上传和切换属于第二阶段，当前页面没有启用任何云端请求。单篇 skill 的输出格式无需修改；先沿用网页导入/监听，再决定是否增加受登录保护的本地上传脚本。网页关闭时无法监听本地文件夹。

## 验证

```bash
npm ci
npm run check
npm test
python -m unittest discover -s tests -v
```

Node 测试使用 fake-indexeddb 验证 IndexedDB 事务，以及 PGlite 执行真实 PostgreSQL SQL，验证外键、不同来源论文统计、分页和账户隔离。这两个包仅为开发测试依赖，不加载到网页。真实 Supabase 登录、网络与部署权限仍需第二阶段验证。

数据库权限设计参考 [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。本地 PostgreSQL 验证使用 [PGlite](https://pglite.dev/docs/)。
