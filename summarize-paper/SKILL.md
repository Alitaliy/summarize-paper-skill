---
name: summarize-paper
description: Faithful academic paper summarization for papers supplied as PDFs, text, Markdown, Word files, or pasted excerpts. Use when Codex needs to summarize a paper's purpose, contributions, techniques, limitations, and prospects, organize its cited references by research direction, and deliver Markdown and Excel outputs while separating source evidence from cautious inference.
---

# Summarize Paper

## Overview

Use this skill to summarize one academic paper from the user-provided source. Extract the paper's purpose, main contributions, techniques, limitations, and future prospects; organize the paper's bibliography into a traceable citation map; then output Markdown, JSON, and Excel files when the environment can create them.

## Core Rules

- Base every factual claim on the supplied paper. Do not add external background, author intent, impact claims, or field context unless the user explicitly asks.
- Separate paper-stated content from inference. Mark each item as `原文明确`, `原文概括`, `合理推测`, or `未提及`.
- Use `合理推测` only when the paper does not directly state the item but the inference follows from nearby methods, results, limitations, or conclusion text.
- Keep inferred language cautious, using phrases such as `可推测`, `可能`, `倾向于说明`, or `未来可进一步`.
- Do not over-interpret. If evidence is weak, mark the item as `未提及` or explain the uncertainty in the evidence column.
- Preserve important details the paper actually states, including task setting, dataset, model/framework, experimental setup, evaluation metrics, and named techniques when relevant.
- Use short evidence references instead of long quotations. Prefer page, section, table, figure, or paragraph anchors when available.
- If the paper text is incomplete, scanned, or extraction quality is poor, state that limitation before the summary and avoid filling gaps with confident claims.
- In user-facing Markdown, group content by the six required dimensions and show multiple claims as bullet points under the same dimension. Do not present repeated `研究目的`, `主要贡献`, or other repeated dimensions as separate visual sections.
- Keep the structured JSON/Excel rows at claim level for traceability, but ensure the rows are ordered by dimension so downstream pages can group them cleanly.
- Build citation groups only from bibliographic entries and citation context present in the supplied paper. Never invent a reference title, author, venue, DOI, URL, or research direction.
- Keep each legible bibliographic entry once under one primary research direction. When classification is uncertain, use `待核查/方向不明` and state why.
- Preserve DOI and URL values exactly when present. A DOI may be converted into a resolver link such as `https://doi.org/<doi>`, but must not be guessed.
- Citation classification is part of every full-paper summary, not an opt-in extra. Count the source bibliography before grouping it; report partial extraction or an unavailable bibliography explicitly.
- Software, documentation, and websites in the bibliography remain traceable entries. Identify their actual role instead of describing them as research papers.

## Workflow

1. Identify the paper source type: PDF, DOCX, Markdown, plaintext, pasted excerpt, or extracted text.
2. Read the abstract, introduction, method, experiments/results, discussion, limitations, and conclusion first.
3. Scan the remaining body for claims that affect the required categories.
4. Build a claim list with evidence anchors before drafting the final summary.
5. Fill the required dimensions:
   - `研究目的`
   - `主要贡献`
   - `使用技术/方法`
   - `实验与结果`
   - `不足/局限`
   - `未来前景/后续工作`
6. For each dimension, include all material points explicitly present in the paper.
7. Add cautious inferred items only after all original-content items, and label them clearly as `合理推测`.
8. Read [references/citation-map.md](references/citation-map.md), inspect the bibliography and citation contexts, count the source entries, then extract and classify every legible entry. Use `reference_status`, `reference_count_expected`, and `reference_note` to record coverage, including when the bibliography is unavailable.
9. Build one JSON record containing the paper metadata, `rows`, `reference_groups`, and coverage fields. Read [references/web-output-contract.md](references/web-output-contract.md) for the exact export and webpage contract.
10. Run `python scripts/write_summary_outputs.py draft.json --output-dir "<one-paper-folder>"`. This validates the record, writes grouped Markdown, saves `summary.json`, and creates a two-sheet Excel workbook from the same data. Use the paper's source folder by default, or the user's selected output folder. Keep one paper per output folder.
11. Check that the source bibliography count and citation contexts agree with the output. The script detects structural errors and count mismatches, but cannot establish whether a classification is faithful to the paper.
12. The webpage can watch the output folder's parent directly. When a separate library inbox is used, archive the three generated files using `scripts/archive_summary_outputs.py`. Do not create a second archive merely to import files already inside the watched library.

## Markdown Output

Use this structure:

```markdown
# 论文总结：<论文标题或用户提供文件名>

## 基本信息

- 标题：
- 作者：
- 年份/会议或期刊：
- DOI：
- 研究领域：
- 资料完整性说明：

## 总览

<用 3-6 句话概括论文解决的问题、方法和结论。只写原文可支持的信息。>

## 逐项总结

### 研究目的
- 【原文明确｜高】...（依据：Abstract; Introduction）
- 【原文概括｜高】...（依据：Introduction）

### 主要贡献
- 【原文明确｜高】...（依据：Contribution bullets）

### 使用技术/方法
- 【原文明确｜高】...（依据：Method）

### 实验与结果
- 【原文明确｜高】...（依据：Experiments; Table 1）

### 不足/局限
- 【原文明确｜高】...（依据：Limitations; Conclusion）

### 未来前景/后续工作
- 【原文明确｜高】...（依据：Conclusion）

## 引用文献脉络

- 整理状态：complete
- 原文引用总数：<从原文参考文献表独立清点的条目数>
- 整理说明：<缺页、无法辨认的编号或其他原文限制；完整时可留空>

### 大方向：<方向名称>

- 方向概括：<说明这组文献共同研究什么，以及它们为何与本文相关。>

| 引用编号 | 题名 | 作者 | 年份 | 来源 | DOI | 链接 | 与本文关系 | 分类依据 | 可追踪性 | 完整引文 |
|---|---|---|---|---|---|---|---|---|---|---|
| [12] | ... | ... | ... | ... | 10.xxxx/... | https://doi.org/... | 方法基础/背景/对比/数据等 | 题名与正文引用位置 | 完整/部分/待核查 | 原文条目，可选 |

## 推测内容清单

| 推测项 | 推测依据 | 置信度 | 后期核查建议 |
|---|---|---|---|
| ... | ... | 高/中/低 | ... |

## 需注意的原文限制
- ...
```

Guidelines:

- Keep original and inferred content visually distinct by putting the type and confidence at the beginning of each bullet, for example `【原文明确｜高】`.
- Each required dimension should appear once as a heading. Put multiple points under that heading as bullets.
- If a dimension has no support in the paper, include one bullet labeled `【未提及｜】` and explain that the paper does not provide the information.
- Add a separate `合理推测` bullet only if a careful inference is useful, and also list it in `推测内容清单`.
- Include the `推测内容清单` even when empty; write `无` when no inference was used.
- The Markdown grouped bullets and the JSON/Excel claim rows must describe the same underlying claims, even though Markdown is grouped for readability.
- Follow the exact citation-map headings and table columns above so the literature management webpage can import Markdown directly.
- Treat citation directions as a classification of the supplied bibliography, not as an external literature review.

## Excel Output

When the user asks for Excel output, or when files can be created, produce an `.xlsx` workbook in addition to Markdown.

Use a `论文总结` worksheet with columns:

- `维度`
- `类型`
- `总结`
- `原文依据/推测依据`
- `置信度`
- `后期核查建议`

Add a second worksheet named `引用文献脉络` with columns:

- `大方向`
- `方向概括`
- `引用编号`
- `题名`
- `作者`
- `年份`
- `来源`
- `DOI`
- `链接`
- `与本文关系`
- `分类依据`
- `可追踪性`
- `完整引文`

Prefer the unified exporter in the workflow. For an Excel-only regeneration or an older JSON record, the existing command remains available:

```bash
python scripts/write_paper_summary_excel.py summary.json paper_summary.xlsx
```

Expected JSON shape:

```json
{
  "paper_title": "Paper title",
  "authors": "Author A; Author B",
  "venue": "Journal or Conference; Year",
  "year": "2026",
  "field": "Research field",
  "overview": "A short paper-level overview for the literature manager card.",
  "reference_status": "complete",
  "reference_count_expected": 1,
  "reference_note": "",
  "reference_groups": [
    {
      "direction": "Research direction",
      "summary": "What this group studies and how it connects to the paper.",
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

Keep JSON and Excel rows as claim-level records, ordered by the six required dimensions. Keep `reference_groups` grouped by direction and references in bibliography order within each group. Include paper-level JSON metadata when available so the literature management webpage can render compact cards and a separate citation-map view.

The abbreviated JSON above illustrates fields, not a complete six-dimension summary. The unified exporter checks all six dimensions. Use `partial` when only part of the bibliography can be recovered, or `unavailable` with `reference_groups: []` when it cannot be read. In both cases supply a source-specific `reference_note`. Do not label a selected subset of references as `complete`.

## Library Archive Output

After creating Markdown, JSON, and Excel outputs, archive them for the dynamic literature management webpage:

```bash
python scripts/archive_summary_outputs.py summary.json paper_summary.md paper_summary.xlsx
```

Archive behavior:

- If `SUMMARIZE_PAPER_LIBRARY_DIR` is set, archive into that directory.
- Otherwise archive into `~/Documents/summarize-paper-library/inbox` when the Documents folder exists.
- Otherwise archive into `~/.summarize-paper-library/inbox`.
- Put each paper in a stable paper-title subfolder and keep `summary.json`, `summary.md`, `summary.xlsx`, and `manifest.json` together.
- Use `--folder-name "Author - Year - Title"` when you want the folder name to match a manually curated `paper/<paper folder>/...` library.
- Use `--timestamped` only when versioned runs should be kept in separate folders.

The webpage can monitor the archive inbox or the parent `paper` folder and automatically refresh when new skill outputs appear. It recursively scans subfolders and imports only `summary.*`, `paper_summary.*`, and `*_paper_summary.*` files, ignoring PDFs and extracted text files.

## Quality Check

Before finishing:

- Confirm each required dimension is present exactly once as a Markdown heading.
- Confirm multiple points inside a dimension are bullets under that heading, not repeated dimension blocks.
- Confirm every factual summary item has an evidence anchor.
- Confirm every inferred item is labeled `合理推测`.
- Confirm no inferred item is mixed into an `原文明确` or `原文概括` row.
- Confirm the JSON and Excel claim rows reconcile with the grouped Markdown bullets.
- Confirm every legible bibliography entry appears exactly once in `reference_groups`, or document why the source reference list could not be fully extracted.
- Confirm each citation direction and relationship is supported by the reference title, venue, or citation context rather than guessed from external knowledge.
- Confirm DOI and URL fields are either copied from the paper or left blank, and that the Markdown, JSON, and Excel citation entries reconcile.
- Confirm missing source information is marked as `未提及` instead of invented.
- Confirm all three formats contain the same reference labels, directions, relationships, and coverage status. No source label should appear in more than one direction.
- Confirm the final `summary.json`, `paper_summary.md`, and `paper_summary.xlsx` are together in one paper folder that the webpage can discover. Do not leave the only JSON copy in a temporary directory.
