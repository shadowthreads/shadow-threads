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

echo "Demo B: Deterministic Workflow Debugging"
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

python3 - "$TMP_DIR/workflow-input.json" <<'PY'
import json
import sys
from pathlib import Path

artifact = {
    "schema": "demo.workflow.input",
    "identity": {
        "packageId": "demo-debug-package",
    },
    "payload": {
        "workflow": "deterministic debug demo",
        "inputBatch": [18, 21, "oops", 34],
        "expectedSteps": [
            "retrieve data",
            "transform data",
            "generate output",
        ],
    },
    "references": [],
}

Path(sys.argv[1]).write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
PY

echo
echo "Capturing the workflow input state"
input_capture_output="$(shadow_cli capture "$TMP_DIR/workflow-input.json")"
printf '%s\n' "$input_capture_output"
input_bundle_hash="$(printf '%s\n' "$input_capture_output" | parse_bundle_hash)"

echo
echo "Running the broken workflow"
if python3 broken_workflow.py --report-out "$TMP_DIR/failure-report.json"; then
  echo "The workflow unexpectedly succeeded" >&2
  exit 1
fi

python3 - "$input_bundle_hash" "$TMP_DIR/failure-report.json" "$TMP_DIR/failure-artifact.json" <<'PY'
import json
import sys
from pathlib import Path

input_bundle_hash = sys.argv[1]
failure_report = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
artifact_path = Path(sys.argv[3])

artifact = {
    "schema": "demo.workflow.failure",
    "identity": {
        "packageId": "demo-debug-package",
    },
    "payload": failure_report,
    "references": [
        {
            "bundleHash": input_bundle_hash,
            "role": "workflow_input",
        }
    ],
}

artifact_path.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
PY

echo
echo "Capturing the failure report"
failure_capture_output="$(shadow_cli capture "$TMP_DIR/failure-artifact.json")"
printf '%s\n' "$failure_capture_output"
failure_bundle_hash="$(printf '%s\n' "$failure_capture_output" | parse_bundle_hash)"

python3 - "$SERVER_URL" "$input_bundle_hash" "$failure_bundle_hash" "$TMP_DIR/debug-state.json" <<'PY'
import hashlib
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

server_url, input_bundle_hash, failure_bundle_hash, output_path = sys.argv[1:5]


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

base_revision = api(
    "POST",
    "/api/v1/revisions",
    {
        "packageId": "demo-debug-package",
        "parentRevisionHash": None,
        "artifacts": [
            {
                "bundleHash": input_bundle_hash,
                "role": "workflow_input",
            }
        ],
        "metadata": {
            "author": "Demo Author",
            "message": "Workflow input state captured before execution",
            "createdBy": "demoB-runner",
            "timestamp": started_at,
            "source": "human",
            "tags": ["demo", "debug"],
        },
    },
)

failure_revision = api(
    "POST",
    "/api/v1/revisions",
    {
        "packageId": "demo-debug-package",
        "parentRevisionHash": base_revision["revisionHash"],
        "artifacts": [
            {
                "bundleHash": input_bundle_hash,
                "role": "workflow_input",
            },
            {
                "bundleHash": failure_bundle_hash,
                "role": "failure_report",
            },
        ],
        "metadata": {
            "author": "Shadow Threads Demo",
            "message": "Failed transform step recorded for debugging",
            "createdBy": "demoB-runner",
            "timestamp": finished_at,
            "source": "system",
            "tags": ["demo", "debug", "failure"],
        },
    },
)

execution = api(
    "POST",
    "/api/v1/executions",
    {
        "packageId": "demo-debug-package",
        "revisionHash": failure_revision["revisionHash"],
        "provider": "demo-script",
        "model": "broken-workflow",
        "promptHash": hashlib.sha256(b"demoB-debug-boundary").hexdigest(),
        "parameters": {
            "stageCount": 3,
            "failureStep": 2,
        },
        "inputArtifacts": [
            {
                "bundleHash": input_bundle_hash,
                "role": "workflow_input",
            }
        ],
        "outputArtifacts": [
            {
                "bundleHash": failure_bundle_hash,
                "role": "failure_report",
            }
        ],
        "status": "failure",
        "startedAt": started_at,
        "finishedAt": finished_at,
    },
)

Path(output_path).write_text(
    json.dumps(
        {
            "revisionHash": failure_revision["revisionHash"],
            "executionId": execution["executionId"],
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
PY

execution_id="$(python3 - "$TMP_DIR/debug-state.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

print(data["executionId"])
PY
)"

echo
echo "Inspecting the recorded execution history"
shadow_cli inspect execution "$execution_id"

echo
echo "Replaying recorded execution boundary"
shadow_cli replay "$execution_id"
echo "Replay verification matched the recorded failed execution boundary."
