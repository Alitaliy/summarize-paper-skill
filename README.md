# summarize-paper 论文总结 Skill

`summarize-paper` 是一个用于学术论文总结的 Codex Skill。它会基于用户提供的一篇论文生成忠实、可追溯的中文总结，并在环境允许时同时输出 Markdown 文档和 Excel 工作簿。

本仓库同时提供一个在线文献管理页面，用来管理这个 skill 生成的总结数据。页面支持手动导入，也支持选择一个输出目录后自动轮询刷新；导入后的文献库保存在浏览器本地。

## 在线文献管理页

GitHub Pages 地址：

```text
https://alitaliy.github.io/summarize-paper-skill/
```

网页位于仓库的 `docs/` 目录，支持两种接入方式：

- 动态监听：点击“监听文件夹”，选择 `paper` 总目录或 skill 的归档输出目录；页面会每 5 秒递归扫描子文件夹中的总结输出并自动刷新。
- 手动导入：直接拖入或选择 `summarize-paper` 生成的 Excel、JSON、Markdown 文件。

网页只围绕 skill 输出的数据进行管理：论文元数据、六类总结，以及按研究方向归并的引用文献。外层缩略卡片只显示标题、DOI、主题和极短内容介绍；点击卡片后可在“论文总结 / 引用脉络”两个页签间切换。引用脉络保留题名、作者、年份、来源、DOI/链接、与本文关系和分类依据，方便继续追踪原始文献。


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
- 固定覆盖六个维度：`研究目的`、`主要贡献`、`使用技术/方法`、`实验与结果`、`不足/局限`、`未来前景/后续工作`。
- 每条总结必须标注来源类型：`原文明确`、`原文概括`、`合理推测` 或 `未提及`。
- 每条事实性内容都要求提供简短证据锚点，例如页码、章节、表格、图号或段落位置。
- 推测内容必须单独标注为 `合理推测`，并使用谨慎措辞。
- Markdown 会按维度大类聚合为小点列表；JSON 与 Excel 保留 claim-level 行记录，便于网页分组展示和证据追踪。
- 参考文献会按研究大方向归并；每条文献只进入一个主要方向，并保留可追踪字段和分类依据。
- Excel 包含 `论文总结` 与 `引用文献脉络` 两个工作表，网页可从 JSON、Markdown 或 Excel 恢复引用分类。

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
    |   `-- citation-map.md
    `-- scripts/
        |-- archive_summary_outputs.py
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

## Excel 生成脚本

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

新版 Excel 还会生成 `引用文献脉络` 工作表，列名为：`大方向`、`方向概括`、`引用编号`、`题名`、`作者`、`年份`、`来源`、`DOI`、`链接`、`与本文关系`、`分类依据`、`可追踪性`。

## 质量检查要求

完成论文总结前，应确认：

- 六个固定维度都已覆盖。
- 每条事实性总结都有原文证据锚点。
- 所有推测内容都标注为 `合理推测`。
- 推测内容没有混入 `原文明确` 或 `原文概括` 行。
- Markdown 与 Excel 的总结行完全一致。
- Markdown、JSON 与 Excel 中的引用方向和文献条目一致；缺失的 DOI 或链接保持为空，不凭空补全。
- 原文没有提供的信息标注为 `未提及`，不凭空补充。
- 如果论文是扫描件、文本抽取不完整或表格/公式抽取混乱，应在总结前说明限制。

## 隐私说明

网页是纯前端页面，不包含后端服务。目录监听使用浏览器 File System Access API，只会读取你主动选择的文件夹；导入的论文总结默认只存储在浏览器 `localStorage` 中，不会上传到服务器。公开部署后，仓库只包含 skill、网页代码和说明文档，不包含你的论文文件或生成的总结数据。

## 许可证

当前仓库未附带开源许可证文件。公开使用或二次分发前，建议根据你的发布意图补充合适的许可证。
