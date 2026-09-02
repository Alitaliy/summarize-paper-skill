# summarize-paper 论文总结 Skill

`summarize-paper` 是一个用于学术论文总结的 Codex Skill。它会基于用户提供的一篇论文生成忠实、可追溯的中文总结，并在环境允许时同时输出 Markdown 文档和 Excel 工作簿。

这个 skill 的核心目标是：只依据论文原文写总结，清晰区分“原文明确说明”“原文概括”“合理推测”和“未提及”的内容，避免把模型推断包装成论文事实。

## 功能概览

- 支持总结 PDF、DOCX、Markdown、纯文本、粘贴片段或已抽取文本形式的论文。
- 固定覆盖六个维度：`研究目的`、`主要贡献`、`使用技术/方法`、`实验与结果`、`不足/局限`、`未来前景/后续工作`。
- 每条总结必须标注来源类型：`原文明确`、`原文概括`、`合理推测` 或 `未提及`。
- 每条事实性内容都要求提供简短证据锚点，例如页码、章节、表格、图号或段落位置。
- 推测内容必须单独标注为 `合理推测`，并使用谨慎措辞。
- Markdown 与 Excel 输出使用同一批结构化行，便于逐行核对。

## 适用场景

- 快速阅读并整理一篇论文的主要信息。
- 做文献综述前的单篇论文结构化摘要。
- 将论文贡献、方法、实验结果和局限整理成可复制到表格的格式。
- 需要保留证据锚点，便于后续核查原文。

## 不适用场景

- 同时总结多篇论文并做横向综述。
- 需要外部检索、引用追踪或判断论文影响力。
- 需要对论文以外的背景知识进行扩展讲解。
- 需要复现论文实验、下载数据集或运行论文代码。

如需真实文献检索、核心论文筛选或 DOI/出版社链接追踪，建议使用专门的文献检索类 skill，而不是本 skill。

## 仓库结构

```text
summarize-paper-skill/
|-- README.md
|-- .gitattributes
|-- .gitignore
`-- summarize-paper/
    |-- SKILL.md
    |-- agents/
    |   `-- openai.yaml
    `-- scripts/
        `-- write_paper_summary_excel.py
```

## 安装方法

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

## 使用示例

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

## 输出格式

### Markdown

Markdown 总结包含以下部分：

- `基本信息`：标题、作者、年份/会议或期刊、研究领域、资料完整性说明。
- `总览`：用 3-6 句话概括论文问题、方法和结论。
- `逐项总结`：按六个固定维度列出结构化总结和证据锚点。
- `推测内容清单`：列出所有合理推测；如果没有推测，则写 `无`。
- `需注意的原文限制`：说明 PDF 抽取、资料完整性、复现信息等限制。

### Excel

Excel 工作簿包含一个工作表：`论文总结`。

表格列如下：

| 列名 | 说明 |
|---|---|
| `维度` | 六个固定总结维度之一 |
| `类型` | `原文明确`、`原文概括`、`合理推测` 或 `未提及` |
| `总结` | 对论文内容的简明总结 |
| `原文依据/推测依据` | 页码、章节、表格、图号或推测依据 |
| `置信度` | `高`、`中`、`低` 或空值 |
| `后期核查建议` | 需要人工复核或后续确认的事项 |

## Excel 生成脚本

仓库内置脚本可以从 JSON 文件生成 `.xlsx` 工作簿：

```bash
python summarize-paper/scripts/write_paper_summary_excel.py summary.json paper_summary.xlsx
```

JSON 输入格式：

```json
{
  "paper_title": "Paper title",
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

脚本会创建一个包含冻结表头、自动筛选和换行样式的 Excel 文件。它不依赖 `openpyxl`，直接生成标准 `.xlsx` 文件。

## 质量检查要求

完成论文总结前，应确认：

- 六个固定维度都已覆盖。
- 每条事实性总结都有原文证据锚点。
- 所有推测内容都标注为 `合理推测`。
- 推测内容没有混入 `原文明确` 或 `原文概括` 行。
- Markdown 与 Excel 的总结行完全一致。
- 原文没有提供的信息标注为 `未提及`，不凭空补充。
- 如果论文是扫描件、文本抽取不完整或表格/公式抽取混乱，应在总结前说明限制。

## 设计原则

- 忠实优先：不添加论文外背景、影响力判断或作者意图，除非用户明确要求。
- 证据优先：每条关键事实都应能回到论文中的具体位置。
- 推测透明：合理推测可以有，但必须单独列出并降低语气强度。
- 输出一致：Markdown 和 Excel 使用同一份结构化数据，避免两份结果不一致。

## 许可证

当前仓库未附带开源许可证文件。公开使用或二次分发前，建议根据你的发布意图补充合适的许可证。
