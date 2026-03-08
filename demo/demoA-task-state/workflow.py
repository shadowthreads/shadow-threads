#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


LOG_LINES = [
    "2026-03-09T09:00:00Z INFO startup complete",
    "2026-03-09T09:01:00Z WARN retrying database connection",
    "2026-03-09T09:02:00Z ERROR parser timeout",
    "2026-03-09T09:03:00Z INFO summary generated",
]


def build_summary() -> dict:
    warn_count = sum(" WARN " in line for line in LOG_LINES)
    error_count = sum(" ERROR " in line for line in LOG_LINES)
    return {
        "task": "build log parser",
        "status": "complete",
        "steps": [
            {"name": "Load data", "status": "done"},
            {"name": "Parse logs", "status": "done"},
            {"name": "Generate summary", "status": "done"},
        ],
        "summary": {
            "lineCount": len(LOG_LINES),
            "warningCount": warn_count,
            "errorCount": error_count,
            "latestMessage": LOG_LINES[-1],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Demo A workflow")
    parser.add_argument("--json-out", help="Optional path for the generated summary JSON")
    args = parser.parse_args()

    print("Step 1 Load data")
    print("Step 2 Parse logs")
    print("Step 3 Generate summary")

    if args.json_out:
        output_path = Path(args.json_out)
        output_path.write_text(json.dumps(build_summary(), indent=2) + "\n", encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
