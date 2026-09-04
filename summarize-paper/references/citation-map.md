# Citation Map

Use this guide when the supplied paper includes a readable bibliography or reference section.

## Goal

Turn the paper's own cited references into a compact reading map. Group references by broad research direction, explain each group's connection to the current paper, and retain enough bibliographic information for the user to find the cited work later.

This is source extraction and classification, not an external literature review. Do not add papers that are absent from the supplied bibliography.

## Classification

- Extract every legible bibliography entry. Preserve its original citation number or author-year label in `ref_id`.
- Assign each entry to one primary direction. Do not duplicate an entry across groups; mention secondary relevance in `relation` when useful.
- Choose directions that describe research topics rather than generic bins such as `其他`. Examples include a theory family, method family, measurement technique, dataset/application domain, or evaluation tradition, but only use categories supported by the actual references.
- Base classification on the cited title, venue, and the current paper's citation context. Record that basis briefly in `classification_basis`.
- Use `待核查/方向不明` when the source omits a title, extraction is damaged, or the available context does not support a reliable direction.
- Write one concise `summary` per direction describing the common topic and how that body of work supports, contrasts with, or motivates the current paper.

## Traceability

Use one of these values:

- `完整`: a DOI or direct URL is present in the supplied paper.
- `部分`: title plus enough author/year/source information is present to search for the work, but no DOI or direct URL is supplied.
- `待核查`: key bibliographic fields are missing or damaged.

Copy DOI and URL values from the supplied paper. You may turn a supplied DOI into `https://doi.org/<doi>`. Leave unknown fields blank; never synthesize them from memory.

## JSON Shape

```json
{
  "reference_groups": [
    {
      "direction": "Broad research direction",
      "summary": "Shared topic and connection to the current paper.",
      "references": [
        {
          "ref_id": "[12]",
          "title": "Cited work title",
          "authors": "Author A; Author B",
          "year": "2022",
          "venue": "Journal or Conference",
          "doi": "10.xxxx/example",
          "url": "https://doi.org/10.xxxx/example",
          "citation": "Optional full bibliography entry when structured fields are incomplete.",
          "relation": "Background, theory, method foundation, comparison, dataset, or application context.",
          "classification_basis": "Title and citation context in Section 2.",
          "traceability": "完整"
        }
      ]
    }
  ]
}
```

Always include `reference_groups`; use an empty array when the bibliography is unavailable. Keep references in their original bibliography order within each group.

## Markdown Shape

Use one `### 大方向：<name>` heading per group, followed by one `方向概括` bullet and a table with these exact columns:

```markdown
### 大方向：<方向名称>

- 方向概括：<共同主题及与本文的联系>

| 引用编号 | 题名 | 作者 | 年份 | 来源 | DOI | 链接 | 与本文关系 | 分类依据 | 可追踪性 |
|---|---|---|---|---|---|---|---|---|---|
| [12] | ... | ... | 2022 | ... | 10.xxxx/example | https://doi.org/10.xxxx/example | 方法基础 | 题名；Section 2 引用语境 | 完整 |
```

Escape literal `|` characters inside cell content. Use one blank row with a short limitation note only when a group is known but its individual entries cannot be recovered.
