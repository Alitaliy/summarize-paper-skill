#!/usr/bin/env python3
"""Validate one paper record and export the formats read by the library webpage."""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path

from write_paper_summary_excel import (
    KEYS, REFERENCE_HEADERS, REFERENCE_KEYS, flatten_reference_rows, write_xlsx,
)

DIMENSIONS = ["研究目的", "主要贡献", "使用技术/方法", "实验与结果", "不足/局限", "未来前景/后续工作"]
TYPES = {"原文明确", "原文概括", "合理推测", "未提及"}
TRACEABILITY = {"完整", "部分", "待核查"}
REFERENCE_STATUSES = {"complete": "引用已完整整理", "partial": "参考文献仅部分可读", "unavailable": "未提供可读参考文献"}


def text(value: object) -> str:
    return "" if value is None else re.sub(r"\s+", " ", str(value)).strip()


def validate_summary(data: object) -> dict:
    """Check observable completeness; the caller must still check claims against the paper."""
    if not isinstance(data, dict):
        raise ValueError("The input must be a paper JSON object.")
    result = copy.deepcopy(data)
    if not text(result.get("paper_title")):
        raise ValueError("paper_title is required.")
    rows = result.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("rows must be a non-empty array.")
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise ValueError(f"Summary row {index} must be an object.")
        for key in KEYS:
            row[key] = text(row.get(key))
        if not all(row[key] for key in ("dimension", "summary", "evidence")):
            raise ValueError(f"Summary row {index} requires dimension, summary and evidence.")
        if row["basis_type"] not in TYPES or row["confidence"] not in {"", "高", "中", "低"}:
            raise ValueError(f"Summary row {index} has an unsupported type or confidence.")
    missing = set(DIMENSIONS) - {row["dimension"] for row in rows}
    if missing:
        raise ValueError(f"Missing summary dimensions: {', '.join(sorted(missing))}")
    order = DIMENSIONS + list(dict.fromkeys(row["dimension"] for row in rows if row["dimension"] not in DIMENSIONS))
    rows.sort(key=lambda row: (order.index(row["dimension"]), row["basis_type"] == "合理推测"))

    status = result.get("reference_status")
    if status not in REFERENCE_STATUSES:
        raise ValueError("reference_status must be complete, partial or unavailable; inspect the bibliography first.")
    result["reference_note"] = text(result.get("reference_note"))
    if status != "complete" and not result["reference_note"]:
        raise ValueError("Partial or unavailable references require reference_note explaining the source limitation.")
    expected = result.get("reference_count_expected")
    if expected is not None and (type(expected) is not int or expected < 0):
        raise ValueError("reference_count_expected must be a non-negative integer or null.")
    if status == "complete" and expected is None:
        raise ValueError("A complete bibliography requires reference_count_expected counted from the source.")
    groups = result.get("reference_groups")
    if not isinstance(groups, list):
        raise ValueError("reference_groups must be an array, including [] when references are unavailable.")
    seen_directions, seen_ids = set(), set()
    count = 0
    for group in groups:
        if not isinstance(group, dict):
            raise ValueError("Each reference group must be an object.")
        group["direction"] = text(group.get("direction"))
        group["summary"] = text(group.get("summary"))
        if not group["direction"] or not group["summary"]:
            raise ValueError("Each direction requires a name and summary.")
        if group["direction"] in seen_directions:
            raise ValueError(f"Duplicate direction: {group['direction']}")
        seen_directions.add(group["direction"])
        refs = group.get("references")
        if not isinstance(refs, list) or not refs:
            raise ValueError("Each group requires references; put bibliography limitations in reference_note.")
        for ref in refs:
            if not isinstance(ref, dict):
                raise ValueError("Each reference must be a structured object.")
            for key in REFERENCE_KEYS[2:]:
                ref[key] = text(ref.get(key))
            if not ref["ref_id"] or not (ref["title"] or ref["citation"]):
                raise ValueError("Each reference requires its source label and either title or full citation.")
            # [12] and 12 denote the same source label; author-year labels stay intact.
            identity = re.sub(r"^\[\s*(.*?)\s*\]$", r"\1", ref["ref_id"]).casefold()
            if identity in seen_ids:
                raise ValueError(f"Duplicate reference label: {ref['ref_id']}")
            seen_ids.add(identity)
            if not ref["relation"] or not ref["classification_basis"]:
                raise ValueError(f"Reference {ref['ref_id']} requires relation and classification_basis.")
            if ref["traceability"] not in TRACEABILITY:
                raise ValueError(f"Reference {ref['ref_id']} requires a valid traceability value.")
            if ref["url"] and not re.match(r"^https?://\S+$", ref["url"], re.I):
                raise ValueError(f"Reference {ref['ref_id']} requires an HTTP(S) URL or a blank URL.")
            if ref["doi"] and not re.match(r"^10\.\d{4,9}/\S+$", ref["doi"]):
                raise ValueError(f"Reference {ref['ref_id']} DOI must be a DOI identifier, not a guessed URL.")
            if ref["traceability"] == "完整" and not (ref["doi"] or ref["url"]):
                raise ValueError(f"Reference {ref['ref_id']} is marked complete but has no DOI or URL.")
            count += 1
    if status == "unavailable" and count:
        raise ValueError("Unavailable references must have an empty reference_groups array.")
    if expected is not None and (count > expected or (status == "complete" and count != expected)):
        raise ValueError(f"Bibliography count mismatch: classified {count}, expected {expected}.")
    for key in ("paper_title", "authors", "venue", "year", "doi", "field", "integrity", "overview"):
        result[key] = text(result.get(key))
    result["schema_version"] = 2
    result["reference_count_expected"] = expected
    return result


def markdown_cell(value: object) -> str:
    # Escape backslashes before pipes so the webpage's table reader reverses them correctly.
    return text(value).replace("\\", "\\\\").replace("|", "\\|")


def markdown_table(headers: list[str], records: list[list[object]]) -> list[str]:
    return ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"] + [
        "| " + " | ".join(markdown_cell(value) for value in row) + " |" for row in records
    ]


def render_markdown(data: dict) -> str:
    lines = [f"# 论文总结：{data['paper_title']}", "", "## 基本信息", ""]
    for label, key in [("标题", "paper_title"), ("作者", "authors"), ("年份/会议或期刊", "venue"),
                       ("年份", "year"), ("DOI", "doi"), ("研究领域", "field"), ("资料完整性说明", "integrity")]:
        lines.append(f"- {label}：{data.get(key) or '未提及'}")
    lines += ["", "## 总览", "", data.get("overview") or "原文未提供可支持的总览。", "", "## 逐项总结", ""]
    for dimension in dict.fromkeys(row["dimension"] for row in data["rows"]):
        rows = [row for row in data["rows"] if row["dimension"] == dimension]
        lines += [f"### {dimension}", ""]
        for row in rows:
            lines.append(f"- 【{row['basis_type']}｜{row['confidence']}】{row['summary']}（依据：{row['evidence']}）")
            if row["review_suggestion"]:
                lines.append(f"  - 核查建议：{row['review_suggestion']}")
        lines.append("")
    status = data["reference_status"]
    lines += ["## 引用文献脉络", "", f"- 整理状态：{status}",
              f"- 状态说明：{REFERENCE_STATUSES[status]}",
              f"- 原文引用总数：{data['reference_count_expected'] if data['reference_count_expected'] is not None else '未能确定'}",
              f"- 整理说明：{data['reference_note']}", ""]
    for group in data["reference_groups"]:
        lines += [f"### 大方向：{group['direction']}", "", f"- 方向概括：{group['summary']}", ""]
        flat = flatten_reference_rows({"reference_groups": [group]})
        lines += markdown_table(REFERENCE_HEADERS[2:], [[ref.get(key, "") for key in REFERENCE_KEYS[2:]] for ref in flat]) + [""]
    lines += ["## 推测内容清单", ""]
    inferred = [row for row in data["rows"] if row["basis_type"] == "合理推测"]
    if inferred:
        lines += markdown_table(["推测项", "推测依据", "置信度", "后期核查建议"],
                                [[row[key] for key in ("summary", "evidence", "confidence", "review_suggestion")] for row in inferred])
    else:
        lines += ["无。"]
    lines += ["", "## 需注意的原文限制", ""]
    limitations = [row["summary"] for row in data["rows"] if row["dimension"] == "不足/局限" and row["basis_type"] != "合理推测"]
    if data["reference_note"]:
        limitations.append(data["reference_note"])
    lines += [f"- {item}" for item in limitations] or ["- 原文未明确列出局限。"]
    return "\n".join(lines) + "\n"


def write_outputs(data: object, output_dir: Path) -> dict[str, Path]:
    normalized = validate_summary(data)  # Validate before creating or replacing any output.
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = {"markdown": output_dir / "paper_summary.md", "json": output_dir / "summary.json", "excel": output_dir / "paper_summary.xlsx"}
    paths["markdown"].write_text(render_markdown(normalized), encoding="utf-8")
    paths["json"].write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_xlsx(normalized, paths["excel"])
    return paths


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_json", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True, help="One paper's folder, within the directory watched by the webpage.")
    args = parser.parse_args(argv)
    try:
        data = json.loads(args.input_json.read_text(encoding="utf-8-sig"))
        paths = write_outputs(data, args.output_dir)
    except (ValueError, OSError) as error:
        parser.exit(2, f"Cannot export paper summary: {error}\n")
    for path in paths.values():
        print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
