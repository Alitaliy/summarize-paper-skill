---
name: summarize-paper
description: Faithful academic paper summarization for papers supplied as PDFs, text, Markdown, Word files, or pasted excerpts. Use when Codex needs to summarize a paper's purpose, main contributions, techniques, limitations, and future prospects, and deliver both Markdown and Excel outputs while clearly separating original evidence from cautious inference.
---

# Summarize Paper

## Overview

Use this skill to summarize one academic paper from the user-provided source. Extract the paper's purpose, main contributions, techniques, limitations, and future prospects, then output both a Markdown summary and an Excel workbook when the environment can create files.

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
8. Produce the Markdown output first, grouping the claim list under dimension headings.
9. Create the Excel output using `scripts/write_paper_summary_excel.py` when file creation is available.
10. Archive the generated Markdown, JSON, and Excel files using `scripts/archive_summary_outputs.py` when file creation is available, so the literature management webpage can auto-discover the new paper. Prefer a local structure where one paper folder contains the source PDF/text extraction and the generated summary outputs; the webpage will only import summary output files.

## Markdown Output

Use this structure:

```markdown
# 论文总结：<论文标题或用户提供文件名>

## 基本信息

- 标题：
- 作者：
- 年份/会议或期刊：
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

## Excel Output

When the user asks for Excel output, or when files can be created, produce an `.xlsx` workbook in addition to Markdown.

Use one worksheet named `论文总结` with columns:

- `维度`
- `类型`
- `总结`
- `原文依据/推测依据`
- `置信度`
- `后期核查建议`

Use `scripts/write_paper_summary_excel.py` to create the workbook from a JSON file:

```bash
python scripts/write_paper_summary_excel.py summary.json paper_summary.xlsx
```

Expected JSON shape:

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

Keep JSON and Excel rows as claim-level records, ordered by the six required dimensions. This preserves precise evidence anchors while allowing the webpage to display each dimension as a large category with bullet points.

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
- Confirm missing source information is marked as `未提及` instead of invented.
- Confirm the generated files were archived for the literature management webpage when file creation is available.

