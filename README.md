# summarize-paper 论文总结 Skill

`summarize-paper` 是一个用于学术论文总结的 Codex Skill。它会基于用户提供的一篇论文生成忠实、可追溯的中文总结，按研究方向分类其引用文献，并从同一份结构化数据生成 Markdown、JSON 和 Excel。

本仓库同时提供一个在线文献管理页面，用来管理这个 skill 生成的总结数据。页面支持手动导入、监听输出目录，以及登录 Supabase 后的跨设备同步。未启用云端时保存在本地 IndexedDB；启用后，论文、星标和分析设置同步到登录账号，本机保留缓存与待上传操作。

## 在线文献管理页

GitHub Pages 地址：

```text
https://alitaliy.github.io/summarize-paper-skill/
```

网页位于仓库的 `docs/` 目录，支持两种接入方式：

- 动态监听：点击“监听文件夹”，选择 `paper` 总目录或 skill 的归档输出目录；页面会每 5 秒递归扫描子文件夹中的总结输出并自动刷新。
- 手动导入：直接拖入或选择 `summarize-paper` 生成的 Excel、JSON、Markdown 文件。

网页围绕 skill 输出的数据进行管理：论文元数据、五个核心问题与局限和未来工作，以及按研究方向归并的引用文献。外层卡片显示标题、DOI、主题和内容介绍；点击卡片后可在“论文总结 / 引用脉络”两个页签间切换。总结按五问顺序展示，旧记录缺失的回答会提示待补充，不自动生成新结论。引用脉络保留题名、作者、年份、来源、DOI/链接、与本文关系和分类依据，方便继续追踪原始文献。


## 动态监听输出目录

推荐把本地文件整理为“每篇论文一个文件夹”，网页监听最上层的 `paper` 目录即可：

```text
paper/
|-- Ferrari 等 - 2020 - Evolution Surfaces for .../
|   |-- Ferrari 等 - 2020 - Evolution Surfaces for ....pdf
|   |-- paper_text_default.txt
|   |-- evolution_surfaces_paper_summary.json
|   |-- evolution_surfaces_paper_summary.md
|   `-- evolution_surfaces_paper_summary.xlsx
`-- Yang 等 - 2023 - Applications of .../
    |-- Yang 等 - 2023 - Applications of ....pdf
    |-- yang_paper_text_default.txt
    |-- yang_paper_summary.json
    |-- yang_paper_summary.md
    `-- yang_paper_summary.xlsx
```

网页只读取 `summary.*`、`paper_summary.*`、`*_paper_summary.*` 这类总结输出文件；PDF、抽取文本、`manifest.json` 和其他素材会被忽略。同一论文文件夹里如果同时存在 JSON、Excel、Markdown，网页优先导入 JSON，其次 Excel，最后 Markdown。

升级后的 skill 也可以在生成 Markdown、JSON 和 Excel 后，把三份文件归档到统一文献库目录。默认目录为：

```text
~/Documents/summarize-paper-library/inbox
```

如果系统没有 `Documents` 目录，则使用：

```text
~/.summarize-paper-library/inbox
```

你也可以用环境变量指定目录：

```bash
export SUMMARIZE_PAPER_LIBRARY_DIR=/path/to/summarize-paper-library/inbox
```

Windows PowerShell 示例：

```powershell
$env:SUMMARIZE_PAPER_LIBRARY_DIR = "$env:USERPROFILE\Documents\summarize-paper-library\inbox"
```

你也可以把环境变量指向自己的 `paper` 总目录：

```powershell
$env:SUMMARIZE_PAPER_LIBRARY_DIR = "C:\Users\你的用户名\Desktop\project\summarize-paper-skill-web\paper"
```

打开在线页面后，点击“监听文件夹”，选择 `paper` 总目录或默认 `inbox` 目录。之后每次 skill 生成新论文总结，只要页面保持打开，它就会自动发现并刷新卡片。

## Skill 功能概览

- 支持总结 PDF、DOCX、Markdown、纯文本、粘贴片段或已抽取文本形式的论文。
- 依次回答五问：`研究目的`（解决什么问题）、`研究动机`（为什么要解决）、`使用技术/方法`（用了什么办法）、`实验与结果`（结果怎么样）、`主要贡献`（到底贡献了什么），最后保留`不足/局限`和`未来前景/后续工作`，共七个维度。
- 每条总结必须标注来源类型：`原文明确`、`原文概括`、`合理推测` 或 `未提及`。
- 每条事实性内容都要求提供简短证据锚点，例如页码、章节、表格、图号或段落位置。
- 推测内容必须单独标注为 `合理推测`，并使用谨慎措辞。
- Markdown 会按维度大类聚合为小点列表；JSON 与 Excel 保留 claim-level 行记录，便于网页分组展示和证据追踪。
- 参考文献会按研究大方向归并；每条文献只进入一个主要方向，并保留可追踪字段和分类依据。
- Excel 包含 `论文总结` 与 `引用文献脉络` 两个工作表，网页可从 JSON、Markdown 或 Excel 恢复引用分类。
- 统一导出会核对原文引用总数、重复编号和分类依据；网页显示完整、部分可读或未提供参考文献的状态。字段缺损的条目可以保留完整引文，便于后续核查。

### 五问覆盖核查与升级

| 问题 | 升级前已有功能 | 本次调整 |
|---|---|---|
| 论文解决什么问题？ | 研究目的 | 明确任务、研究对象、目标与条件 |
| 为什么要解决？ | 未独立要求，可能混在研究目的中 | 新增研究动机，要求说明原文中的不足、需求与意义 |
| 用了什么办法？ | 使用技术/方法 | 说明流程、核心机制与已有技术的使用方式 |
| 实验结果怎么样？ | 实验与结果 | 关联数据、对比方法、指标、数值和适用条件 |
| 这个方法到底贡献了什么？ | 主要贡献 | 移到结果之后，说明新增内容及其证据支持的价值 |

详细写作要求见[五问说明](summarize-paper/references/five-questions.md)。新版统一导出要求七个维度完整，缺少研究动机会报错；原文不支持回答时须明确标注并解释资料限制。旧六维度总结仍能导入网页，单独生成 Excel 也保持兼容。网页仅调整阅读顺序和缺项提示，不改写旧结论或增加总结点数；要补全旧总结，需要依据原文重新整理。

## 仓库结构

```text
summarize-paper-skill/
|-- README.md
|-- .gitattributes
|-- .gitignore
|-- docs/
|   |-- index.html
|   |-- styles.css
|   `-- app.js
`-- summarize-paper/
    |-- SKILL.md
    |-- agents/
    |   `-- openai.yaml
    |-- references/
    |   |-- citation-map.md
    |   |-- five-questions.md
    |   `-- web-output-contract.md
    `-- scripts/
        |-- archive_summary_outputs.py
        |-- write_summary_outputs.py
        |-- summary_dimensions.py
        `-- write_paper_summary_excel.py
```

## 安装 Skill

将仓库克隆到本地，然后把 `summarize-paper` 文件夹复制到 Codex skills 目录。

### macOS / Linux

```bash
git clone https://github.com/Alitaliy/summarize-paper-skill.git
mkdir -p ~/.codex/skills
cp -R summarize-paper-skill/summarize-paper ~/.codex/skills/
```

### Windows PowerShell

```powershell
git clone https://github.com/Alitaliy/summarize-paper-skill.git
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills" | Out-Null
Copy-Item -Recurse -Force ".\summarize-paper-skill\summarize-paper" "$env:USERPROFILE\.codex\skills\"
```

如果你设置了 `CODEX_HOME`，请复制到 `$CODEX_HOME/skills`，而不是默认的 `~/.codex/skills`。

升级已有安装时，先更新仓库，再重新复制整个 `summarize-paper` 文件夹。仅更新网页或仓库，不会自动更新已安装到本机的 skill；只替换 `SKILL.md` 也会漏掉导出脚本和格式说明。新版入口包含 `write_summary_outputs.py`，安装后可在本机 skill 的 `scripts/` 下确认。

## 使用 Skill

在 Codex 中显式调用：

```text
Use $summarize-paper to summarize this paper and output Markdown and Excel.
```

中文请求示例：

```text
[$summarize-paper](path/to/SKILL.md) 帮我按照这个 skill 要求总结当前目录下的这篇论文
```

也可以直接说明输出要求：

```text
请使用 summarize-paper skill，总结这篇 PDF，并生成 Markdown 和 Excel 两份结果。
```

## 统一生成三种输出

完成原文阅读和引用分类后，把论文元数据、七个维度的总结条目、`reference_groups` 和引用覆盖字段写入同一份 JSON，再运行：

```bash
python summarize-paper/scripts/write_summary_outputs.py draft.json --output-dir "paper/Author - Year - Title"
```

该命令只需 Python 标准库，生成 `paper_summary.md`、`summary.json`、`paper_summary.xlsx`。JSON 是网页监听时优先读取的来源；三份文件放在同一篇论文的文件夹中。修改引用分类后用相同输入重新生成三份输出，避免旧 JSON 遮住新 Excel 的引用信息。

引用覆盖使用三个字段：

| 字段 | 含义 |
|---|---|
| `reference_status` | `complete` 表示全部原文条目均已整理，`partial` 表示只能读取部分，`unavailable` 表示未提供可读参考文献。 |
| `reference_count_expected` | 从原文参考文献表独立清点的总数；不确定时用 `null`。完整状态必须填入并核对总数。 |
| `reference_note` | 缺页、无法辨认的编号或其他整理限制；部分或不可读时必须说明。 |

统一导出在写入前检查重复引用编号、数量不一致、缺少分类依据等问题。研究方向及引用关系仍需由阅读原文的人或智能体判断。文中的软件、协议文档和网页引用也保留，并明确其资源性质。

完整格式见 [引用分类说明](summarize-paper/references/citation-map.md) 和 [网页接入约定](summarize-paper/references/web-output-contract.md)。以下 JSON 是字段片段；实际统一导出输入应覆盖全部七个总结维度。

## 单独生成 Excel

仓库内置脚本可以从 JSON 文件生成 `.xlsx` 工作簿：

```bash
python summarize-paper/scripts/write_paper_summary_excel.py summary.json paper_summary.xlsx
```

JSON 输入格式：

```json
{
  "paper_title": "Paper title",
  "authors": "Author A; Author B",
  "venue": "Journal or Conference; Year",
  "year": "2026",
  "field": "Research field",
  "overview": "A short paper-level overview for the card and detail header.",
  "reference_status": "complete",
  "reference_count_expected": 1,
  "reference_note": "",
  "reference_groups": [
    {
      "direction": "Research direction",
      "summary": "Shared topic and connection to the current paper.",
      "references": [
        {
          "ref_id": "[12]",
          "title": "Cited paper title",
          "authors": "Author A; Author B",
          "year": "2022",
          "venue": "Journal or Conference",
          "doi": "10.xxxx/example",
          "url": "https://doi.org/10.xxxx/example",
          "relation": "Method foundation",
          "classification_basis": "Reference title; citation context in Introduction",
          "traceability": "完整"
        }
      ]
    }
  ],
  "rows": [
    {
      "dimension": "研究目的",
      "basis_type": "原文明确",
      "summary": "What the paper states.",
      "evidence": "Abstract; Introduction.",
      "confidence": "高",
      "review_suggestion": ""
    }
  ]
}
```

## 网页接入数据

每次运行 skill 后，可以把生成的 Excel、JSON 和 Markdown 放进对应论文文件夹。网页监听 `paper` 总目录后会递归扫描全部论文文件夹并自动导入；也可以继续手动拖入文件。推荐保留 JSON，因为它和 Excel 使用同一批结构化行，导入最稳定。

卡片墙优先使用 JSON 或同目录 Markdown 中的论文级元数据：标题、作者、期刊/会议年份、研究领域和总览。Excel 仍可单独导入，但如果希望卡片信息更完整，建议同时保留 Markdown 或在 JSON 中写入这些论文级字段。

每张卡片右上角的星星用于重点标记。点击后点亮，再次点击取消；状态随论文条目保存在当前浏览器中，刷新页面或重新导入同一篇论文后仍会保留。

### 全局引用分析

点击网页中的“全局引用分析”，或直接打开 [引用分析子页](https://alitaliy.github.io/summarize-paper-skill/#/citations)，即可分析当前浏览器文献库中已有的 `reference_groups`，不需要重新生成总结。

- **库内被引篇数**：一篇被引文献出现在多少篇不同来源论文中。同一来源的重复引用、多个引用方向，以及可识别的重复来源记录，只贡献一次；不是正文引用出现次数或学术界总被引量。
- **识别与去重**：优先使用 DOI、arXiv 标识；没有标识时使用规范化题名与年份（或作者）匹配，并标注需要核查。多个 DOI 冲突时，不会通过相同题名自动合并；缺少身份信息的条目按来源独立保留。普通网页地址、局部引用编号都不能单独作为全局文献标识。预印本和正式发表版本只有在标识关联明确或人工确认后才合并。
- **方向分析**：沿用原始引用分类。选择方向后，排行显示该方向内不同来源论文的篇数，同时列出全库篇数。方向分布展示独立被引文献数和引用关系数，跨方向可能重叠，不能直接相加。
- **追溯来源**：点击排行查看引用关系图、全部来源论文及其原始引用编号、关系和分类依据。图中的节点可打开原有论文详情；来源很多时，图只显示前 12 篇，完整列表仍全部保留。
- **整理与纠错**：可归并全局方向名称，也可人工确认合并重复文献、撤销最近一次合并。调整只影响统计，原始总结和引用条目不变。分析设置保存在本地，随“导出库”一起导出，导入库 JSON 时恢复。
- **数据边界**：概览显示完整、部分、不可读和未知的引用整理状态。统计包含原始参考文献中的论文、软件、文档及网页；缺失引用和待核查记录会影响排名。分析全库数据，不继承文献卡片页的搜索或总结维度筛选。

子页继续使用纯前端和浏览器本地存储；新增、更新或删除来源论文后更新分析索引，搜索、切换页面和星标复用缓存。旧库没有分析设置也可以正常使用。`analysis_settings` 是网页导出库的附加字段，不要求 skill 修改单篇论文输出。

### 本地优化与迁移准备

新版页面会自动升级原浏览器中的旧库，并保留升级前的存储副本。保存按事务执行，失败时保留原状态并显示提示。论文与引用使用稳定编号，引用补充 DOI 后仍可追踪已有合并规则；不能确定的历史合并会在分析页提示。

“导出库”包含论文、星标和分析设置；“导出迁移包”生成经过关联与计数核对的关系表数据，也可以重新导入网页恢复。两种导出只下载文件。上传需要通过“云端同步”登录，并选择迁移/合并本地库或使用云端库。

Supabase 配置、首次迁移、离线恢复与冲突处理见 [迁移与同步说明](migrations/README.md)。全局排行在已同步且无搜索词时读取云端 SQL 统计，搜索与离线分析使用本机缓存。单篇 skill 输出格式保持兼容，网页监听到新总结后会继续导入并同步。

### 阅读与引用分析性能

论文详情只在首次切换到“引用脉络”时创建引用列表，再次打开同一篇未修改的论文复用内容。全局分析复用未变化的排名、关系图和来源列表，云端统计确认不会重置展开的引用语境。后台同步检查、上传确认和 SQL 排名校验只读取 IndexedDB 元数据；内容或分类设置发生变化时才重新加载整库。旧版标签页写入仍会触发更新；不支持 IndexedDB 的浏览器继续使用原有兼容存储。

阅读弹层使用半透明遮罩，移除全屏背景模糊。长列表采用浏览器的 [`content-visibility: auto`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility) 跳过远离视口内容的布局和绘制，保留完整文本、页面查找和键盘访问；打印时恢复完整绘制。

`node tests/performance.cjs` 使用 16 篇模拟论文、960 条引用验证重复工作量：未打开引用页的节点数从 665 降至 0，再次打开论文新建节点从 680 降至 0，同一引用重复选中新建节点从 213 降至 0，云端排名确认新建节点从 413 降至 0。测试同时验证修改后的总结与引用能及时更新。这些是 Node 测试环境中的工作量计数，不代表实际浏览器帧率或速度倍率。

如果使用归档脚本，可以这样把输出放入稳定的论文文件夹：

```bash
python summarize-paper/scripts/archive_summary_outputs.py summary.json paper_summary.md paper_summary.xlsx --library-dir ./paper --folder-name "Ferrari 等 - 2020 - Evolution Surfaces for Spatiotemporal Visualization of Vortex Features"
```

默认情况下，同一篇论文会写入同一个文件夹；如果想保留每次运行的版本，可以额外加 `--timestamped`。

如果只拿到 Excel，也可以直接导入。网页会读取 `论文总结` 工作表，并自动识别以下列名：

- `维度`
- `类型`
- `总结`
- `原文依据/推测依据`
- `置信度`
- `后期核查建议`

新版 Excel 还会生成 `引用文献脉络` 工作表，列名为：`大方向`、`方向概括`、`引用编号`、`题名`、`作者`、`年份`、`来源`、`DOI`、`链接`、`与本文关系`、`分类依据`、`可追踪性`、`完整引文`。第二行记录整理状态、原文引用总数和说明，第三行是引用表头。网页会自动寻找表头，因此仍可读取旧版工作簿。

## 验证开发改动

需要 Python 3.10+ 和 Node.js 22+。Python 测试无需第三方库；Node 的 IndexedDB 和 PostgreSQL 测试依赖通过 npm 安装，不会打包到网页：

```bash
python -m unittest discover -s tests -v
npm ci
npm run check
npm test
```

测试用合成条目生成三种格式，并通过网页实际使用的解析函数核对总结、引用分组和整理状态。Excel 测试独立解析生成文件的单元格后交给网页读取逻辑，不依赖在线 CDN。GitHub Actions 在提交和拉取请求时运行同样的检查。

## 质量检查要求

完成论文总结前，应确认：

- 五个核心问题按指定顺序回答，并保留局限和未来工作，共七个维度。
- 每条事实性总结都有原文证据锚点。
- 所有推测内容都标注为 `合理推测`。
- 推测内容没有混入 `原文明确` 或 `原文概括` 行。
- Markdown 与 Excel 的总结行完全一致。
- Markdown、JSON 与 Excel 中的引用方向和文献条目一致；缺失的 DOI 或链接保持为空，不凭空补全。
- 原文没有提供的信息标注为 `未提及`，不凭空补充。
- 如果论文是扫描件、文本抽取不完整或表格/公式抽取混乱，应在总结前说明限制。

## 隐私说明

网页是静态前端，可选择登录 Supabase 账号启用云端同步。目录监听使用浏览器 File System Access API，只读取你主动选择的文件夹；本地模式保存在浏览器 IndexedDB 中，不支持 IndexedDB 时使用 `localStorage` 兼容存储。启用云端库后，导入内容和后续修改同步到当前账号，本机保留独立缓存。公开仓库只包含 skill、网页代码、公开客户端配置、迁移结构和模拟测试，不包含你的论文文件或生成的总结数据。

## 许可证

当前仓库未附带开源许可证文件。公开使用或二次分发前，建议根据你的发布意图补充合适的许可证。
