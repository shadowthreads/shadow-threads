#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${SHADOW_SERVER:-http://localhost:3001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

resolve_shadow_cli() {
  if command -v shadow >/dev/null 2>&1; then
    SHADOW_CMD=(shadow)
    return
  fi

  if [ -f "$REPO_ROOT/cli/dist/index.js" ]; then
    SHADOW_CMD=(node "$REPO_ROOT/cli/dist/index.js")
    return
  fi

  echo "Shadow CLI not found. Build the CLI first from cli/." >&2
  exit 1
}

shadow_cli() {
  "${SHADOW_CMD[@]}" "$@"
}

parse_bundle_hash() {
  python3 -c 'import re, sys
text = sys.stdin.read()
match = re.search(r"bundleHash:\\s*([0-9a-f]{64})", text)
if match is None:
    raise SystemExit("bundleHash not found")
print(match.group(1))'
}

require_command python3
require_command node
resolve_shadow_cli

cd "$SCRIPT_DIR"

echo "Demo A: Task State Management"
echo "Server: $SERVER_URL"
echo
echo "Initializing the demo workspace"
shadow_cli init

python3 - "$SERVER_URL" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path("shadow.config.json")
config = json.loads(config_path.read_text(encoding="utf-8"))
config["server"] = sys.argv[1]
config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
PY

echo
echo "Capturing the starting task state"
artifact_capture_output="$(shadow_cli capture artifact.json)"
printf '%s\n' "$artifact_capture_output"
task_bundle_hash="$(printf '%s\n' "$artifact_capture_output" | parse_bundle_hash)"

echo
echo "Running the task with visible progress"
python3 workflow.py --json-out "$TMP_DIR/workflow-summary.json"

python3 - "$task_bundle_hash" "$TMP_DIR/workflow-summary.json" "$TMP_DIR/summary-artifact.json" <<'PY'
import json
import sys
from pathlib import Path

task_bundle_hash = sys.argv[1]
summary_data = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
artifact_path = Path(sys.argv[3])

artifact = {
    "schema": "demo.task.summary",
    "identity": {
        "packageId": "demo-package",
    },
    "payload": summary_data,
    "references": [
        {
            "bundleHash": task_bundle_hash,
            "role": "source_task",
        }
    ],
}

artifact_path.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
PY

echo
echo "Capturing the completed task state"
summary_capture_output="$(shadow_cli capture "$TMP_DIR/summary-artifact.json")"
printf '%s\n' "$summary_capture_output"
summary_bundle_hash="$(printf '%s\n' "$summary_capture_output" | parse_bundle_hash)"

python3 - "$SERVER_URL" "$task_bundle_hash" "$summary_bundle_hash" "$TMP_DIR/demo-state.json" <<'PY'
import hashlib
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

server_url, task_bundle_hash, summary_bundle_hash, output_path = sys.argv[1:5]


def api(method: str, path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        server_url.rstrip("/") + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"API request failed: {error.code} {details}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"Unable to reach {server_url}: {error.reason}") from error

    if not body.get("ok"):
        raise SystemExit(f"API request failed: {body}")

    return body["data"]


timestamp = datetime.now(timezone.utc)
started_at = timestamp.isoformat()
finished_at = (timestamp + timedelta(seconds=2)).isoformat()

initial_revision = api(
    "POST",
    "/api/v1/revisions",
    {
        "packageId": "demo-package",
        "parentRevisionHash": None,
        "artifacts": [
            {
                "bundleHash": task_bundle_hash,
                "role": "task_state",
            }
        ],
        "metadata": {
            "author": "Demo Author",
            "message": "Task state captured before workflow execution",
            "createdBy": "demoA-runner",
            "timestamp": started_at,
            "source": "human",
            "tags": ["demo", "task-state"],
        },
    },
)

final_revision = api(
    "POST",
    "/api/v1/revisions",
    {
        "packageId": "demo-package",
        "parentRevisionHash": initial_revision["revisionHash"],
        "artifacts": [
            {
                "bundleHash": task_bundle_hash,
                "role": "task_state",
            },
            {
                "bundleHash": summary_bundle_hash,
                "role": "task_summary",
            },
        ],
        "metadata": {
            "author": "Shadow Threads Demo",
            "message": "Task progress recorded after summary generation",
            "createdBy": "demoA-runner",
            "timestamp": finished_at,
            "source": "ai",
            "tags": ["demo", "task-state", "history"],
        },
    },
)

execution = api(
    "POST",
    "/api/v1/executions",
    {
        "packageId": "demo-package",
        "revisionHash": final_revision["revisionHash"],
        "provider": "demo-script",
        "model": "task-state-workflow",
        "promptHash": hashlib.sha256(b"demoA-task-state-workflow").hexdigest(),
        "parameters": {
            "mode": "demo",
            "stepCount": 3,
        },
        "inputArtifacts": [
            {
                "bundleHash": task_bundle_hash,
                "role": "task_state",
            }
        ],
        "outputArtifacts": [
            {
                "bundleHash": summary_bundle_hash,
                "role": "task_summary",
            }
        ],
        "status": "success",
        "startedAt": started_at,
        "finishedAt": finished_at,
    },
)

Path(output_path).write_text(
    json.dumps(
        {
            "initialRevisionHash": initial_revision["revisionHash"],
            "finalRevisionHash": final_revision["revisionHash"],
            "executionId": execution["executionId"],
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
PY

final_revision_hash="$(python3 - "$TMP_DIR/demo-state.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

print(data["finalRevisionHash"])
PY
)"

execution_id="$(python3 - "$TMP_DIR/demo-state.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

print(data["executionId"])
PY
)"

echo
echo "History recorded for this task"
echo "Inspecting the latest task revision"
shadow_cli inspect revision "$final_revision_hash"

echo
echo "Inspecting the execution history"
shadow_cli inspect execution "$execution_id"

echo
echo "Replaying the recorded task execution boundary"
shadow_cli replay "$execution_id"
echo "Replay verification matched the recorded task execution boundary."
