from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

import anyio
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


EXPECTED_TOOLS = {
    "shadow_capture_artifact",
    "shadow_get_artifact",
    "shadow_create_revision",
    "shadow_get_revision",
    "shadow_list_revisions",
    "shadow_record_execution",
    "shadow_get_execution",
    "shadow_replay_execution",
}


def utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def extract_tool_payload(result: Any) -> dict[str, Any]:
    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict):
        return structured

    for item in getattr(result, "content", []):
        json_payload = getattr(item, "json", None)
        if isinstance(json_payload, dict):
            return json_payload

        text_payload = getattr(item, "text", None)
        if isinstance(text_payload, str):
            try:
                parsed = json.loads(text_payload)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed

    raise RuntimeError("MCP tool returned no structured payload")


def print_error_and_exit(error: Exception | None = None, result: Any | None = None) -> int:
    if result is not None:
        try:
            payload = extract_tool_payload(result)
        except Exception:
            payload = {
                "error_type": "MCPToolError",
                "status_code": None,
                "api_code": None,
                "message": "MCP tool call failed without structured error payload",
            }
    else:
        payload = {
            "error_type": error.__class__.__name__ if error is not None else "RuntimeError",
            "status_code": getattr(error, "status_code", None) if error is not None else None,
            "api_code": getattr(error, "code", None) if error is not None else None,
            "message": str(error) if error is not None else "Unknown error",
        }

    print(json.dumps(payload, indent=2), file=sys.stderr)
    return 1


async def async_main() -> int:
    server = os.getenv("SHADOW_SERVER", "http://localhost:3001")
    print(f"Using server: {server}")

    env = dict(os.environ)
    env["SHADOW_SERVER"] = server

    server_parameters = StdioServerParameters(
        command="shadowthreads-mcp",
        env=env,
    )

    async with stdio_client(server_parameters) as streams:
        async with ClientSession(*streams) as session:
            await session.initialize()

            tools = await session.list_tools()
            tool_entries = getattr(tools, "tools", tools)
            available = {tool.name for tool in tool_entries}
            missing = EXPECTED_TOOLS - available
            if missing:
                raise RuntimeError(f"MCP missing tools: {sorted(missing)}")

            capture_result = await session.call_tool(
                "shadow_capture_artifact",
                {
                    "schema": "sdk.demo.task",
                    "package_id": "mcp-live-demo-package",
                    "payload": {
                        "task": "mcp live validation",
                        "input": "validate MCP layer end-to-end",
                    },
                },
            )
            if getattr(capture_result, "isError", False):
                return print_error_and_exit(result=capture_result)
            artifact = extract_tool_payload(capture_result)
            bundle_hash = artifact["bundle_hash"]
            print(f"Captured artifact: {bundle_hash}")

            started_at = datetime.now(timezone.utc)
            finished_at = started_at + timedelta(seconds=1)

            revision_result = await session.call_tool(
                "shadow_create_revision",
                {
                    "package_id": "mcp-live-demo-package",
                    "artifacts": [
                        {
                            "bundle_hash": bundle_hash,
                            "role": "task_state",
                        }
                    ],
                    "metadata": {
                        "author": "MCP Live Validation",
                        "message": "Create revision for MCP validation",
                        "created_by": "mcp-live-validation",
                        "timestamp": utc_iso(started_at),
                        "source": "human",
                        "tags": ["mcp", "live-validation"],
                    },
                },
            )
            if getattr(revision_result, "isError", False):
                return print_error_and_exit(result=revision_result)
            revision = extract_tool_payload(revision_result)
            revision_hash = revision["revision_hash"]
            print(f"Created revision: {revision_hash}")

            prompt_hash = hashlib.sha256(b"shadowthreads-mcp-live-validation").hexdigest()
            execution_result = await session.call_tool(
                "shadow_record_execution",
                {
                    "package_id": "mcp-live-demo-package",
                    "revision_hash": revision_hash,
                    "provider": "python-mcp",
                    "model": "live-validation",
                    "prompt_hash": prompt_hash,
                    "parameters": {
                        "mode": "mcp-validation",
                        "temperature": 0,
                    },
                    "input_artifacts": [
                        {
                            "bundle_hash": bundle_hash,
                            "role": "task_state",
                        }
                    ],
                    "output_artifacts": [
                        {
                            "bundle_hash": bundle_hash,
                            "role": "task_state",
                        }
                    ],
                    "status": "success",
                    "started_at": utc_iso(started_at),
                    "finished_at": utc_iso(finished_at),
                },
            )
            if getattr(execution_result, "isError", False):
                return print_error_and_exit(result=execution_result)
            execution = extract_tool_payload(execution_result)
            execution_id = execution["execution_id"]
            print(f"Recorded execution: {execution_id}")

            replay_result = await session.call_tool(
                "shadow_replay_execution",
                {
                    "execution_id": execution_id,
                },
            )
            if getattr(replay_result, "isError", False):
                return print_error_and_exit(result=replay_result)
            replay = extract_tool_payload(replay_result)
            print(f"Replay verified: {str(bool(replay['verified'])).lower()}")
            print("MCP live validation complete")
            return 0


def main() -> int:
    try:
        return anyio.run(async_main)
    except Exception as error:
        return print_error_and_exit(error=error)


if __name__ == "__main__":
    raise SystemExit(main())
