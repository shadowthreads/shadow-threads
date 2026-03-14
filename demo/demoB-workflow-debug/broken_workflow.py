#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


INPUT_BATCH = [18, 21, "oops", 34]


def run_workflow() -> dict:
    print("Step 1 OK")

    for item in INPUT_BATCH:
        if not isinstance(item, int):
            error_message = f"transform step expected integers but received {item!r}"
            print("Step 2 FAILED")
            return {
                "workflow": "deterministic debug demo",
                "failedStep": 2,
                "stepName": "transform data",
                "inputBatch": INPUT_BATCH,
                "error": error_message,
            }

    print("Step 2 OK")
    print("Step 3 OK")
    return {
        "workflow": "deterministic debug demo",
        "failedStep": None,
        "stepName": None,
        "inputBatch": INPUT_BATCH,
        "output": [item * 2 for item in INPUT_BATCH],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Demo B broken workflow")
    parser.add_argument("--report-out", help="Optional path for a JSON failure report")
    args = parser.parse_args()

    report = run_workflow()
    if args.report_out:
        Path(args.report_out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    return 1 if report["failedStep"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
