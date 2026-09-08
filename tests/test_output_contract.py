"""Portable exporter checks and round trips through the actual webpage readers."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "summarize-paper" / "scripts"))
from write_summary_outputs import DIMENSIONS, validate_summary, write_outputs
from write_paper_summary_excel import write_xlsx


def fixture():
    return {
        "paper_title": "引用脉络格式测试（虚构示例）", "authors": "Test Author", "year": "2026",
        "venue": "Format test, 2026", "field": "测试数据", "overview": "仅用于检验三种格式的衔接。",
        "integrity": "合成数据，不是研究结论。", "reference_status": "complete",
        "reference_count_expected": 2, "reference_note": "测试数据，仅验证格式。",
        "rows": [{"dimension": name, "basis_type": "合理推测" if i == 5 else "原文概括",
                  "summary": f"测试条目 {i + 1}，保留 | 与括号（示例）。", "evidence": f"第{i + 1}页（测试定位）",
                  "confidence": "中" if i == 5 else "高", "review_suggestion": "核查原文（示例）。" if i == 5 else ""}
                 for i, name in enumerate(DIMENSIONS)],
        "reference_groups": [
            {"direction": "方法设计", "summary": "测试分类与原文锚点。", "references": [
                {"ref_id": "[1]", "title": "Method A | B \\ C (Fixture)", "authors": "Example Author", "year": "2025",
                 "venue": "Test", "doi": "", "url": "https://example.org/method-a",
                 "relation": "相关方法（测试）", "classification_basis": "第2页§2，[1]引用语境。",
                 "traceability": "完整", "citation": "[1] Example Author. Method A | B \\ C (Fixture). 2025."}]},
            {"direction": "待核查/方向不明", "summary": "测试缺失题名时保留原文条目。", "references": [
                {"ref_id": "[2]", "title": "", "authors": "", "year": "2024", "venue": "", "doi": "", "url": "",
                 "relation": "引用角色未能确认", "classification_basis": "第3页参考文献[2]，题名缺损。",
                 "traceability": "待核查", "citation": "[2] [Title unreadable], 2024."}]},
        ],
    }


def workbook_matrices(path):
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as archive:
        names = [node.attrib["name"] for node in ET.fromstring(archive.read("xl/workbook.xml")).findall("m:sheets/m:sheet", ns)]
        matrices = {}
        for i, name in enumerate(names, 1):
            sheet = ET.fromstring(archive.read(f"xl/worksheets/sheet{i}.xml"))
            matrix = []
            for row in sheet.findall("m:sheetData/m:row", ns):
                values = []
                for cell in row.findall("m:c", ns):
                    letters = ''.join(c for c in cell.attrib["r"] if c.isalpha())
                    column = 0
                    for c in letters:
                        column = column * 26 + ord(c) - 64
                    while len(values) < column:
                        values.append("")
                    values[column - 1] = ''.join(cell.itertext())
                matrix.append(values)
            matrices[name] = matrix
            children = [node.tag.split('}')[-1] for node in sheet]
            if "autoFilter" in children and "mergeCells" in children:
                assert children.index("autoFilter") < children.index("mergeCells")
        return {"SheetNames": names, "Sheets": matrices}


class OutputContractTests(unittest.TestCase):
    def test_unified_command_line(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "draft.json"
            source.write_text(json.dumps(fixture(), ensure_ascii=False), encoding="utf-8")
            output = Path(directory) / "paper"
            process = subprocess.run([sys.executable, "-X", "utf8", str(ROOT / "summarize-paper/scripts/write_summary_outputs.py"),
                                      str(source), "--output-dir", str(output)], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual({p.name for p in output.iterdir()}, {"summary.json", "paper_summary.md", "paper_summary.xlsx"})

    def test_source_coverage_and_duplicate_checks(self):
        for change in ("duplicate", "missing", "no_evidence", "no_status", "empty_group", "invalid_url"):
            with self.subTest(change=change):
                data = fixture()
                if change == "duplicate":
                    data["reference_groups"][1]["references"][0]["ref_id"] = "1"
                elif change == "missing":
                    data["reference_count_expected"] = 3
                elif change == "no_evidence":
                    data["reference_groups"][0]["references"][0]["classification_basis"] = ""
                elif change == "no_status":
                    del data["reference_status"]
                elif change == "empty_group":
                    data["reference_groups"][0]["references"] = []
                else:
                    data["reference_groups"][0]["references"][0]["url"] = "javascript:alert(1)"
                with self.assertRaises(ValueError):
                    validate_summary(data)

    def test_failed_validation_preserves_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "paper_summary.md"
            target.write_text("existing output", encoding="utf-8")
            data = fixture()
            data["reference_count_expected"] = 3
            with self.assertRaises(ValueError):
                write_outputs(data, Path(directory))
            self.assertEqual(target.read_text(encoding="utf-8"), "existing output")

    def test_exports_round_trip_through_web_readers(self):
        if not shutil.which("node"):
            self.fail("Node.js is required for webpage contract tests.")
        for status in ("complete", "partial", "unavailable"):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                data = fixture()
                if status == "partial":
                    data.update(reference_status=status, reference_count_expected=3, reference_note="第[3]条所在页面缺失。")
                elif status == "unavailable":
                    data.update(reference_status=status, reference_count_expected=None, reference_note="所提供片段不含参考文献。", reference_groups=[])
                paths = write_outputs(data, Path(directory))
                workbook = workbook_matrices(paths["excel"])
                self.assertEqual(workbook["SheetNames"], ["论文总结", "引用文献脉络"])
                (Path(directory) / "workbook.json").write_text(json.dumps(workbook, ensure_ascii=False), encoding="utf-8")
                result = subprocess.run(["node", str(ROOT / "tests" / "web_contract.cjs"), directory], capture_output=True, text=True, encoding="utf-8")
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_legacy_excel_command_and_empty_reference_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            data = fixture()
            del data["reference_groups"]
            del data["reference_status"]
            output = Path(directory) / "legacy.xlsx"
            write_xlsx(data, output)
            matrices = workbook_matrices(output)
            self.assertEqual(len(matrices["Sheets"]["论文总结"]), 8)
            self.assertEqual(len(matrices["Sheets"]["引用文献脉络"]), 3)

    def test_zero_references_is_distinct_from_unavailable(self):
        data = fixture()
        data.update(reference_groups=[], reference_count_expected=0, reference_note="原文明示无参考文献。")
        self.assertEqual(validate_summary(data)["reference_status"], "complete")
        data.update(reference_status="unavailable", reference_note="")
        with self.assertRaises(ValueError):
            validate_summary(data)


if __name__ == "__main__":
    unittest.main()
