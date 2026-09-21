# Webpage Output Contract

Use this reference before exporting a summary for the companion library at
https://alitaliy.github.io/summarize-paper-skill/ . The website is a local-file reader;
generating a summary does not upload its contents to GitHub.

## One record, three files

Create one UTF-8 JSON record with `paper_title`, paper-level metadata when available,
the seven-dimension `rows`, and the citation groups defined in [citation-map.md](citation-map.md).
Include the three bibliography coverage fields even when no bibliography was supplied.

Order the dimensions as `研究目的`, `研究动机`, `使用技术/方法`, `实验与结果`,
`主要贡献`, `不足/局限`, `未来前景/后续工作`. The first five answer the questions
in [five-questions.md](five-questions.md). Each Markdown heading retains its canonical
dimension name, followed by a quoted question prompt; the prompt is not a claim row.

```bash
python scripts/write_summary_outputs.py draft.json --output-dir "paper/Author - Year - Title"
```

This standard-library script validates the input before writing:

- `paper_summary.md`: dimension headings and tagged summary bullets, then `## 引用文献脉络`, direction headings and citation tables.
- `summary.json`: the same record, normalized to `schema_version: 2`; this is the preferred webpage import source.
- `paper_summary.xlsx`: `论文总结` and `引用文献脉络` worksheets containing the same summary and citation records.

Do not manually maintain divergent citation lists across formats. After editing a
classification, regenerate all three from the JSON. The exporter checks unique source
labels, required classification evidence, reference counts, seven summary dimensions,
and explicit limitations. It cannot verify source fidelity or prove a DOI is correct.

Keep source IDs and bibliography order within each direction. Each group has
`direction`, `summary`, and `references`. Each reference uses `ref_id`, `title`,
`authors`, `year`, `venue`, `doi`, `url`, `relation`, `classification_basis`,
`traceability`, and optionally `citation`. Unknown bibliographic fields stay blank.
The original citation is especially useful when the title cannot be extracted.

## Reader compatibility

The JSON schema remains version 2 and the workbook keeps the same six summary
columns; no cloud database migration is needed. Old six-dimension files remain
readable. The webpage orders known dimensions using the five questions and shows
a missing-answer notice for questions absent from an unfiltered summary, without
creating claim rows or changing counts, stars, citations, or stored records.
These notices describe missing summary content, not a finding that the original
paper failed to address the question. Re-read the source before upgrading old outputs.
The unified exporter requires all seven dimensions for new full summaries. The
Excel-only exporter still accepts old records and sorts their existing claims into
the current dimension order without filling missing fields.

The webpage's JSON reader uses `reference_groups`. Its Markdown reader recognizes
`## 引用文献脉络`, `### 大方向：…`, `- 方向概括：…`, and the documented Chinese table
headers. The worksheet reader locates the `大方向` header dynamically. Preserve these
names; renaming them to a similar phrase prevents automatic import.

Excel citation columns, in order:

`大方向`, `方向概括`, `引用编号`, `题名`, `作者`, `年份`, `来源`, `DOI`, `链接`,
`与本文关系`, `分类依据`, `可追踪性`, `完整引文`.

The first twelve remain compatible with old files. The optional last column preserves
raw citations. The citation worksheet has the title in row 1; row 2 stores the
label/value pairs `整理状态`, `原文引用总数`, and `整理说明`; row 3 has column headers.
The browser also accepts older workbooks whose column headers are in row 2.

Markdown coverage fields are `整理状态` (`complete`, `partial`, or `unavailable`),
`原文引用总数` (integer or `未能确定`), and `整理说明`. An indented `核查建议` bullet
belongs to the preceding summary point. Table-form summaries with four or six
columns remain readable. Old files without coverage metadata remain importable;
the webpage must not claim that their reference lists are complete.

## Discovering the output

The page's “监听文件夹” recursively reads summary files in child directories. It
chooses one import source per paper folder, preferring JSON, then Excel, then Markdown.
It can supplement metadata from the companion Markdown. Therefore:

- Keep one paper per folder and all three outputs together.
- Update an old `summary.json` when adding references; leaving a stale JSON beside a new Excel can hide the new classification.
- Retain the recognized output basenames. A separate `references.json` or a temporary draft is not a substitute for `summary.json`.
- Users can also directly import any one of the three files and open the “引用脉络” tab.

Use `archive_summary_outputs.py` only when the desired watched library is separate
from the chosen output directory. Do not modify browser storage or an existing paper
library merely to generate output files.
