from __future__ import annotations

import pathlib
import sys
import unittest

import anyio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from shadowthreads import (  # type: ignore[import-not-found]
    ArtifactBundle,
    ArtifactCaptureResult,
    ArtifactIdentity,
    ArtifactRecord,
    ArtifactReference,
    ExecutionRecord,
    ReplayExecutionResult,
    RevisionRecord,
)
from shadowthreads_mcp.server import create_server
from shadowthreads_mcp.tools import register_tools


class FakeClient:
    last_instance: "FakeClient | None" = None

    def __init__(self, *, base_url: str) -> None:
        self.base_url = base_url
        self.closed = False
        self.calls: list[tuple[str, tuple, dict]] = []
        FakeClient.last_instance = self

    def close(self) -> None:
        self.closed = True

    def capture_artifact(self, **kwargs):
        self.calls.append(("capture_artifact", (), kwargs))
        return ArtifactCaptureResult(
            id="artifact-1",
            bundle_hash="a" * 64,
            created_at="2026-03-09T09:00:00.000Z",
        )

    def get_artifact(self, package_id: str, bundle_hash: str):
        self.calls.append(("get_artifact", (package_id, bundle_hash), {}))
        return ArtifactRecord(
            id="artifact-1",
            bundle_hash=bundle_hash,
            created_at="2026-03-09T09:00:00.000Z",
            artifact_bundle=ArtifactBundle(
                schema="sdk.demo.task",
                identity=ArtifactIdentity(package_id=package_id),
                payload={"task": "demo"},
                references=[],
            ),
        )

    def create_revision(self, **kwargs):
        self.calls.append(("create_revision", (), kwargs))
        return type(
            "CreateRevisionResult",
            (),
            {
                "revision": RevisionRecord(
                    revision_hash="b" * 64,
                    package_id=kwargs["package_id"],
                    parent_revision_hash=kwargs["parent_revision_hash"],
                    author=kwargs["metadata"].author,
                    message=kwargs["metadata"].message,
                    created_by=kwargs["metadata"].created_by,
                    timestamp=kwargs["metadata"].timestamp,
                    source=kwargs["metadata"].source,
                    metadata=kwargs["metadata"].to_payload(),
                    created_at="2026-03-09T09:00:01.000Z",
                    artifacts=list(kwargs["artifacts"]),
                )
            },
        )()

    def get_revision(self, revision_hash: str):
        self.calls.append(("get_revision", (revision_hash,), {}))
        return RevisionRecord(
            revision_hash=revision_hash,
            package_id="pkg-1",
            parent_revision_hash=None,
            author="author",
            message="message",
            created_by="creator",
            timestamp="2026-03-09T09:00:00+00:00",
            source="human",
            metadata={},
            created_at="2026-03-09T09:00:01.000Z",
            artifacts=[ArtifactReference(bundle_hash="a" * 64, role="task_state")],
        )

    def list_revisions(self, package_id: str, limit: int | None = None):
        self.calls.append(("list_revisions", (package_id,), {"limit": limit}))
        return [self.get_revision("c" * 64)]

    def record_execution(self, **kwargs):
        self.calls.append(("record_execution", (), kwargs))
        return type(
            "CreateExecutionResult",
            (),
            {
                "execution": ExecutionRecord(
                    execution_id="11111111-1111-4111-8111-111111111111",
                    package_id=kwargs["package_id"],
                    revision_hash=kwargs["revision_hash"],
                    provider=kwargs["provider"],
                    model=kwargs["model"],
                    prompt_hash=kwargs["prompt_hash"],
                    parameters=kwargs["parameters"],
                    input_artifacts=list(kwargs["input_artifacts"]),
                    output_artifacts=list(kwargs["output_artifacts"]),
                    result_hash="d" * 64,
                    status=kwargs["status"],
                    started_at=kwargs["started_at"],
                    finished_at=kwargs["finished_at"],
                    created_at="2026-03-09T09:00:02.000Z",
                )
            },
        )()

    def get_execution(self, execution_id: str):
        self.calls.append(("get_execution", (execution_id,), {}))
        return ExecutionRecord(
            execution_id=execution_id,
            package_id="pkg-1",
            revision_hash="b" * 64,
            provider="provider",
            model="model",
            prompt_hash="e" * 64,
            parameters={"mode": "demo"},
            input_artifacts=[ArtifactReference(bundle_hash="a" * 64, role="task_state")],
            output_artifacts=[ArtifactReference(bundle_hash="a" * 64, role="task_state")],
            result_hash="d" * 64,
            status="success",
            started_at="2026-03-09T09:00:00+00:00",
            finished_at="2026-03-09T09:00:02+00:00",
            created_at="2026-03-09T09:00:02.000Z",
        )

    def replay_execution(self, execution_id: str):
        self.calls.append(("replay_execution", (execution_id,), {}))
        return ReplayExecutionResult(
            execution_id=execution_id,
            verified=True,
            result_hash="d" * 64,
        )


class MCPToolTests(unittest.TestCase):
    def build_server(self):
        from mcp.server.fastmcp import FastMCP

        server = FastMCP("test-shadow-mcp", json_response=True)
        register_tools(server, client_factory=FakeClient)
        return server

    def test_registers_expected_tool_names(self) -> None:
        server = self.build_server()

        async def run():
            tools = await server.list_tools()
            return sorted(tool.name for tool in tools)

        names = anyio.run(run)
        self.assertEqual(
            names,
            [
                "shadow_capture_artifact",
                "shadow_create_revision",
                "shadow_get_artifact",
                "shadow_get_execution",
                "shadow_get_revision",
                "shadow_list_revisions",
                "shadow_record_execution",
                "shadow_replay_execution",
            ],
        )

    def test_capture_artifact_delegates_to_sdk(self) -> None:
        server = self.build_server()

        async def run():
            return await server.call_tool(
                "shadow_capture_artifact",
                {
                    "schema": "sdk.demo.task",
                    "package_id": "pkg-1",
                    "payload": {"task": "demo"},
                    "references": [{"bundle_hash": "a" * 64, "role": "task_state"}],
                },
            )

        result = anyio.run(run)
        self.assertFalse(result.isError)
        self.assertEqual(result.structuredContent["bundle_hash"], "a" * 64)
        assert FakeClient.last_instance is not None
        call_name, _, kwargs = FakeClient.last_instance.calls[0]
        self.assertEqual(call_name, "capture_artifact")
        self.assertEqual(kwargs["package_id"], "pkg-1")
        self.assertEqual(kwargs["references"][0].role, "task_state")
        self.assertTrue(FakeClient.last_instance.closed)

    def test_create_revision_returns_full_revision_record(self) -> None:
        server = self.build_server()

        async def run():
            return await server.call_tool(
                "shadow_create_revision",
                {
                    "package_id": "pkg-1",
                    "artifacts": [{"bundle_hash": "a" * 64, "role": "task_state"}],
                    "metadata": {
                        "author": "author",
                        "message": "message",
                        "created_by": "creator",
                        "timestamp": "2026-03-09T09:00:00+00:00",
                        "source": "human",
                        "tags": ["sdk"],
                    },
                },
            )

        result = anyio.run(run)
        self.assertFalse(result.isError)
        self.assertEqual(result.structuredContent["revision_hash"], "b" * 64)
        self.assertEqual(result.structuredContent["artifacts"][0]["role"], "task_state")

    def test_record_execution_returns_full_execution_record(self) -> None:
        server = self.build_server()

        async def run():
            return await server.call_tool(
                "shadow_record_execution",
                {
                    "package_id": "pkg-1",
                    "revision_hash": "b" * 64,
                    "provider": "provider",
                    "model": "model",
                    "prompt_hash": "e" * 64,
                    "parameters": {"mode": "demo"},
                    "input_artifacts": [{"bundle_hash": "a" * 64, "role": "task_state"}],
                    "output_artifacts": [{"bundle_hash": "a" * 64, "role": "task_state"}],
                    "status": "success",
                    "started_at": "2026-03-09T09:00:00+00:00",
                    "finished_at": "2026-03-09T09:00:02+00:00",
                },
            )

        result = anyio.run(run)
        self.assertFalse(result.isError)
        self.assertEqual(
            result.structuredContent["execution_id"],
            "11111111-1111-4111-8111-111111111111",
        )
        self.assertEqual(result.structuredContent["status"], "success")

    def test_replay_execution_uses_execution_id_only(self) -> None:
        server = self.build_server()

        async def run():
            return await server.call_tool(
                "shadow_replay_execution",
                {"execution_id": "11111111-1111-4111-8111-111111111111"},
            )

        result = anyio.run(run)
        self.assertFalse(result.isError)
        self.assertTrue(result.structuredContent["verified"])
        assert FakeClient.last_instance is not None
        self.assertEqual(FakeClient.last_instance.calls[0][0], "replay_execution")
        self.assertEqual(
            FakeClient.last_instance.calls[0][1][0],
            "11111111-1111-4111-8111-111111111111",
        )


if __name__ == "__main__":
    unittest.main()
