"""Shared question order for the Markdown/JSON and Excel exporters."""

QUESTIONS = {
    "研究目的": "论文解决什么问题？",
    "研究动机": "为什么要解决？",
    "使用技术/方法": "用了什么办法？",
    "实验与结果": "实验结果怎么样？",
    "主要贡献": "这个方法到底贡献了什么？",
}
DIMENSIONS = [*QUESTIONS, "不足/局限", "未来前景/后续工作"]


def ordered_summary_rows(rows: list[dict]) -> list[dict]:
    """Keep claims intact, preserve custom dimensions, place inferences last per group."""
    extra = list(dict.fromkeys(row.get("dimension", "") for row in rows if row.get("dimension", "") not in DIMENSIONS))
    order = {name: position for position, name in enumerate([*DIMENSIONS, *extra])}
    return sorted(rows, key=lambda row: (order[row.get("dimension", "")], row.get("basis_type") == "合理推测"))
