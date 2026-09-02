#!/usr/bin/env python3
"""Archive summarize-paper outputs into a shared local library inbox."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def default_library_dir() -> Path:
    env_dir = os_environ("SUMMARIZE_PAPER_LIBRARY_DIR")
    if env_dir:
        return Path(env_dir).expanduser()

    home = Path.home()
    documents = home / "Documents"
    if documents.exists():
        return documents / "summarize-paper-library" / "inbox"
    return home / ".summarize-paper-library" / "inbox"


def os_environ(name: str) -> str:
    import os

    return os.environ.get(name, "").strip()


def read_title(json_path: Path | None, fallback: str) -> str:
    if not json_path or not json_path.exists():
        return fallback
    try:
        data = json.loads(json_path.read_text(encoding="utf-8-sig"))
    except Exception:
        return fallback
    return str(data.get("paper_title") or data.get("title") or fallback).strip() or fallback


def slugify(value: str) -> str:
    text = re.sub(r"[^\w\u4e00-\u9fff.-]+", "-", value, flags=re.UNICODE).strip("-._")
    text = re.sub(r"-{2,}", "-", text)
    return (text or "paper-summary")[:80]


def archive_outputs(files: list[Path], output_dir: Path | None = None) -> Path:
    existing = [path for path in files if path.exists()]
    if not existing:
        raise FileNotFoundError("No existing output files were provided.")

    json_file = next((path for path in existing if path.suffix.lower() == ".json"), None)
    title = read_title(json_file, existing[0].stem)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    target_root = output_dir or default_library_dir()
    target_dir = target_root / f"{slugify(title)}-{timestamp}"
    target_dir.mkdir(parents=True, exist_ok=True)

    copied = []
    for path in existing:
        suffix = path.suffix.lower()
        if suffix == ".json":
            name = "summary.json"
        elif suffix in {".md", ".markdown"}:
            name = "summary.md"
        elif suffix in {".xlsx", ".xls"}:
            name = "summary.xlsx"
        else:
            name = path.name
        destination = target_dir / name
        shutil.copy2(path, destination)
        copied.append({"source": str(path), "archived_as": name})

    manifest = {
        "paper_title": title,
        "archived_at": datetime.now(timezone.utc).isoformat(),
        "files": copied,
    }
    (target_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return target_dir


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Archive summarize-paper outputs into the local library inbox.")
    parser.add_argument("files", nargs="+", type=Path, help="Generated summary files, such as summary.json, summary.md, and summary.xlsx.")
    parser.add_argument("--library-dir", type=Path, default=None, help="Override the archive directory. Defaults to SUMMARIZE_PAPER_LIBRARY_DIR or Documents/summarize-paper-library/inbox.")
    args = parser.parse_args(argv)
    target = archive_outputs(args.files, args.library_dir)
    print(f"Archived summarize-paper outputs to {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
