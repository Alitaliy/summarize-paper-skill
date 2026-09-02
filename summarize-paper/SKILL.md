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
8. Produce the Markdown output first, then create the Excel output using `scripts/write_paper_summary_excel.py` when file creation is available.

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

| 维度 | 类型 | 总结 | 原文依据/推测依据 |
|---|---|---|---|
| 研究目的 | 原文明确/原文概括/合理推测/未提及 | ... | ... |
| 主要贡献 | 原文明确/原文概括/合理推测/未提及 | ... | ... |
| 使用技术/方法 | 原文明确/原文概括/合理推测/未提及 | ... | ... |
| 实验与结果 | 原文明确/原文概括/合理推测/未提及 | ... | ... |
| 不足/局限 | 原文明确/原文概括/合理推测/未提及 | ... | ... |
| 未来前景/后续工作 | 原文明确/原文概括/合理推测/未提及 | ... | ... |

## 推测内容清单

| 推测项 | 推测依据 | 置信度 | 后期核查建议 |
|---|---|---|---|
| ... | ... | 高/中/低 | ... |

## 需注意的原文限制

- ...
```

Guidelines:

- Keep original and inferred content visually distinct.
- If a dimension has multiple points, use numbered clauses inside the same table cell or split into multiple rows with the same dimension.
- Use `未提及` for truly absent categories, then add a separate `合理推测` row only if a careful inference is useful.
- Include the `推测内容清单` even when empty; write `无` when no inference was used.

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

Use the same rows in Markdown and Excel so the two outputs reconcile exactly.

## Quality Check

Before finishing:

- Confirm each required dimension is present.
- Confirm every factual summary item has an evidence anchor.
- Confirm every inferred item is labeled `合理推测`.
- Confirm no inferred item is mixed into an `原文明确` or `原文概括` row.
- Confirm the Excel rows match the Markdown table rows.
- Confirm missing source information is marked as `未提及` instead of invented.
