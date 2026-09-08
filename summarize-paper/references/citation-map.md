# Citation Map

Use this guide when the supplied paper includes a readable bibliography or reference section.

## Goal

Turn the paper's own cited references into a compact reading map. Group references by broad research direction, explain each group's connection to the current paper, and retain enough bibliographic information for the user to find the cited work later.

This is source extraction and classification, not an external literature review. Do not add papers that are absent from the supplied bibliography.

## Classification

- Extract every legible bibliography entry. Preserve its original citation number or author-year label in `ref_id`.
- First count entries in the source bibliography independently of the classification. Check the labels again after grouping so omissions are visible. For author-year references, preserve distinguishing suffixes such as `2024a` and `2024b`.
- Assign each entry to one primary direction. Do not duplicate an entry across groups; mention secondary relevance in `relation` when useful.
- Choose directions that describe research topics rather than generic bins such as `其他`. Examples include a theory family, method family, measurement technique, dataset/application domain, or evaluation tradition, but only use categories supported by the actual references.
- Base classification on the cited title, venue, and the current paper's citation context. Record that basis briefly in `classification_basis`.
- Use `待核查/方向不明` when the source omits a title, extraction is damaged, or the available context does not support a reliable direction.
- Write one concise `summary` per direction describing the common topic and how that body of work supports, contrasts with, or motivates the current paper.
- In `relation`, describe how the current paper uses the reference: background, adopted component, method foundation, comparison discussed in related work, evaluation, dataset, or future direction. A related-work citation is not automatically an experimental baseline; an optimizer mentioned as future work is not an implemented component.
- Include a page/section anchor and the source label in `classification_basis` when context is available. For title-only classification, say so. Classifying a cited work from the current paper does not mean its full text has been read.
- Preserve non-paper entries such as software repositories, protocol documentation, and product webpages. Use an appropriate direction and make their resource type clear in `relation`.
- Keep an incomplete entry's readable original text in `citation`. If the label and partial citation remain legible, include it under `待核查/方向不明`; do not fabricate the missing title. When an entire entry cannot be recovered, name the omitted label in `reference_note` and use `partial`.

## Traceability

Use one of these values:

- `完整`: a DOI or direct URL is present in the supplied paper.
- `部分`: title plus enough author/year/source information is present to search for the work, but no DOI or direct URL is supplied.
- `待核查`: key bibliographic fields are missing or damaged.

Copy DOI and URL values from the supplied paper. You may turn a supplied DOI into `https://doi.org/<doi>`. Leave unknown fields blank; never synthesize them from memory.

`完整` describes locator availability, not independent verification of the cited paper or the correctness of its results. It does not mean the entire bibliography has been extracted; bibliography coverage uses the separate fields below.

## Bibliography Coverage

- `reference_status: "complete"`: every source entry has been represented once. `reference_count_expected` is the independently counted source total and must equal the number of classified entries.
- `reference_status: "partial"`: pages or entries are missing/unreadable. Set the expected total when known, otherwise `null`, and explain the omission in `reference_note`.
- `reference_status: "unavailable"`: no readable bibliography was supplied. Use `reference_groups: []`, an expected total of `null` when unknown, and a source-specific note.
- A paper explicitly containing zero references may use `complete`, an expected total of `0`, and an empty group array. Do not use this for an unprovided reference section.

## JSON Shape

```json
{
  "reference_status": "complete",
  "reference_count_expected": 1,
  "reference_note": "",
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

| 引用编号 | 题名 | 作者 | 年份 | 来源 | DOI | 链接 | 与本文关系 | 分类依据 | 可追踪性 | 完整引文 |
|---|---|---|---|---|---|---|---|---|---|---|
| [12] | ... | ... | 2022 | ... | 10.xxxx/example | https://doi.org/10.xxxx/example | 方法基础 | 题名；Section 2 引用语境 | 完整 | 原文条目，可选 |
```

The unified exporter escapes cell separators and preserves `citation` in all three formats. Do not create empty reference rows to hold notes; use `reference_note` so the webpage does not count a limitation as a cited work. See [web-output-contract.md](web-output-contract.md) for export and import details.
