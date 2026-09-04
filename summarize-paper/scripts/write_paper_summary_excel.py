#!/usr/bin/env python3
"""Create an XLSX workbook for a paper summary from a small JSON file."""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape


HEADERS = [
    "维度",
    "类型",
    "总结",
    "原文依据/推测依据",
    "置信度",
    "后期核查建议",
]

KEYS = [
    "dimension",
    "basis_type",
    "summary",
    "evidence",
    "confidence",
    "review_suggestion",
]

REFERENCE_HEADERS = [
    "大方向",
    "方向概括",
    "引用编号",
    "题名",
    "作者",
    "年份",
    "来源",
    "DOI",
    "链接",
    "与本文关系",
    "分类依据",
    "可追踪性",
]

REFERENCE_KEYS = [
    "direction",
    "direction_summary",
    "ref_id",
    "title",
    "authors",
    "year",
    "venue",
    "doi",
    "url",
    "relation",
    "classification_basis",
    "traceability",
]


def sanitize_sheet_name(name: str) -> str:
    name = re.sub(r"[\[\]\:\*\?\/\\]", " ", name).strip()
    return (name or "论文总结")[:31]


def cell_ref(row: int, col: int) -> str:
    letters = ""
    while col:
        col, rem = divmod(col - 1, 26)
        letters = chr(65 + rem) + letters
    return f"{letters}{row}"


def inline_cell(row: int, col: int, value: object, style: int | None = None) -> str:
    text = "" if value is None else str(value)
    style_attr = f' s="{style}"' if style is not None else ""
    return (
        f'<c r="{cell_ref(row, col)}" t="inlineStr"{style_attr}>'
        f"<is><t>{escape(text)}</t></is></c>"
    )


def worksheet_xml(title: str, rows: list[dict[str, object]]) -> str:
    xml_rows = []
    xml_rows.append(
        '<row r="1" ht="24" customHeight="1">'
        + inline_cell(1, 1, f"论文总结：{title}", 1)
        + "</row>"
    )
    xml_rows.append(
        '<row r="2">'
        + "".join(inline_cell(2, idx + 1, header, 2) for idx, header in enumerate(HEADERS))
        + "</row>"
    )

    for row_idx, item in enumerate(rows, start=3):
        cells = []
        for col_idx, key in enumerate(KEYS, start=1):
            cells.append(inline_cell(row_idx, col_idx, item.get(key, ""), None))
        xml_rows.append(f'<row r="{row_idx}">' + "".join(cells) + "</row>")

    last_row = max(len(rows) + 2, 2)
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="18" customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="58" customWidth="1"/>
    <col min="4" max="4" width="42" customWidth="1"/>
    <col min="5" max="5" width="12" customWidth="1"/>
    <col min="6" max="6" width="32" customWidth="1"/>
  </cols>
  <sheetData>{''.join(xml_rows)}</sheetData>
  <mergeCells count="1"><mergeCell ref="A1:F1"/></mergeCells>
  <autoFilter ref="A2:F{last_row}"/>
</worksheet>'''


def flatten_reference_rows(data: dict[str, object]) -> list[dict[str, object]]:
    groups = data.get("reference_groups")
    if not isinstance(groups, list):
        return []

    output: list[dict[str, object]] = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        direction = group.get("direction") or group.get("name") or "待核查/方向不明"
        direction_summary = group.get("summary") or group.get("description") or ""
        references = group.get("references")
        if not isinstance(references, list) or not references:
            output.append({"direction": direction, "direction_summary": direction_summary})
            continue
        for reference in references:
            if isinstance(reference, str):
                reference = {"citation": reference}
            if not isinstance(reference, dict):
                continue
            output.append(
                {
                    "direction": direction,
                    "direction_summary": direction_summary,
                    "ref_id": reference.get("ref_id") or reference.get("label") or reference.get("number") or "",
                    "title": reference.get("title") or reference.get("citation") or "",
                    "authors": reference.get("authors") or reference.get("author") or "",
                    "year": reference.get("year") or "",
                    "venue": reference.get("venue") or reference.get("source") or "",
                    "doi": reference.get("doi") or "",
                    "url": reference.get("url") or reference.get("link") or "",
                    "relation": reference.get("relation") or "",
                    "classification_basis": reference.get("classification_basis") or reference.get("basis") or "",
                    "traceability": reference.get("traceability") or "",
                }
            )
    return output


def reference_worksheet_xml(title: str, rows: list[dict[str, object]]) -> str:
    xml_rows = [
        '<row r="1" ht="24" customHeight="1">'
        + inline_cell(1, 1, f"引用文献脉络：{title}", 1)
        + "</row>",
        '<row r="2">'
        + "".join(inline_cell(2, idx + 1, header, 2) for idx, header in enumerate(REFERENCE_HEADERS))
        + "</row>",
    ]

    for row_idx, item in enumerate(rows, start=3):
        cells = [inline_cell(row_idx, col_idx, item.get(key, ""), None) for col_idx, key in enumerate(REFERENCE_KEYS, start=1)]
        xml_rows.append(f'<row r="{row_idx}">' + "".join(cells) + "</row>")

    widths = [22, 38, 12, 48, 28, 10, 28, 24, 36, 28, 34, 12]
    columns = "".join(
        f'<col min="{idx}" max="{idx}" width="{width}" customWidth="1"/>'
        for idx, width in enumerate(widths, start=1)
    )
    last_row = max(len(rows) + 2, 2)
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>{columns}</cols>
  <sheetData>{''.join(xml_rows)}</sheetData>
  <mergeCells count="1"><mergeCell ref="A1:L1"/></mergeCells>
  <autoFilter ref="A2:L{last_row}"/>
</worksheet>'''


def write_xlsx(data: dict[str, object], output_path: Path) -> None:
    title = str(data.get("paper_title") or "未命名论文")
    rows = data.get("rows")
    if not isinstance(rows, list):
        raise ValueError("JSON must contain a 'rows' array.")
    reference_rows = flatten_reference_rows(data)

    sheet_name = sanitize_sheet_name("论文总结")
    reference_sheet_name = sanitize_sheet_name("引用文献脉络")
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    files = {
        "[Content_Types].xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>''',
        "_rels/.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>''',
        "xl/workbook.xml": f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="{escape(sheet_name)}" sheetId="1" r:id="rId1"/>
    <sheet name="{escape(reference_sheet_name)}" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>''',
        "xl/_rels/workbook.xml.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>''',
        "xl/worksheets/sheet1.xml": worksheet_xml(title, rows),
        "xl/worksheets/sheet2.xml": reference_worksheet_xml(title, reference_rows),
        "xl/styles.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>''',
        "docProps/core.xml": f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{escape(title)}</dc:title>
  <dc:creator>summarize-paper skill</dc:creator>
  <cp:lastModifiedBy>summarize-paper skill</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{created}</dcterms:modified>
</cp:coreProperties>''',
        "docProps/app.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Codex</Application>
</Properties>''',
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for archive_name, content in files.items():
            archive.writestr(archive_name, content)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Create paper summary XLSX from JSON.")
    parser.add_argument("input_json", type=Path)
    parser.add_argument("output_xlsx", type=Path)
    args = parser.parse_args(argv)

    data = json.loads(args.input_json.read_text(encoding="utf-8-sig"))
    write_xlsx(data, args.output_xlsx)
    print(f"Wrote {args.output_xlsx}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
